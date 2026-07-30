import Joi from 'joi';
import { asyncHandler, handleError, handleSuccess, joiErrorHandle } from '../../utils/responseHandler.js';
import * as appointmentModel from '../../models/appointment.js';
import * as doctorModel from '../../models/doctor.js';
import * as chatModel from '../../models/chat.js';
import dayjs from 'dayjs';
import { getDocterByDocterId } from '../../models/doctor.js';
import { getChatBetweenUsers } from '../../models/chat.js';
import { NOTIFICATION_MESSAGES, sendNotification } from '../../services/notifications.service.js';
import pkg from 'rrule';
import { generateSlots, weekdayMap } from '../api/authController.js';
import { extractUserData, getTreatmentIDsByUserID } from '../../utils/misc.util.js';
const { RRule } = pkg;
const APP_URL = process.env.APP_URL;
import { v4 as uuidv4 } from "uuid";
import { isEmpty } from '../../utils/user_helper.js';
import { getTreatmentsByAppointmentId, getTreatmentsByTreatmentDoctorId, getTreatmentsByTreatmentIds } from '../../models/api.js';

export const getMyAppointmentsDoctor = async (req, res) => {
    try {
        await appointmentModel.updateMissedAppointmentStatusModel();
        const userId = req?.user?.user_id;
        const doctorId = req?.user?.doctorData?.doctor_id;
        const clinicId = req?.user?.clinicData?.clinic_id;
        const now = dayjs.utc();
        const appointments = clinicId ? await appointmentModel?.getAppointmentsByClinicByclinicID(clinicId) : await appointmentModel?.getAppointmentsByDoctorId(doctorId, 'booked');
        const result = await Promise?.all(appointments?.map(async (app) => {
            const doctor = await getDocterByDocterId(app.doctor_id);
            let chatId = await getChatBetweenUsers(userId, doctor[0]?.zynq_user_id);
            app.chatId = chatId.length > 0 ? chatId[0].id : null;
            // Ensure profile image is fully qualified
            if (app.profile_image && !app.profile_image.startsWith('http')) {
                app.profile_image = `${APP_URL}${app.profile_image}`;
            };
            let start_time_iso = null;
            let end_time_iso = null;
            let videoCallOn = false;
            if (app.start_time && app.end_time) {
                const startUTC = dayjs.utc(app.start_time);
                const endUTC = dayjs.utc(app.end_time);
                start_time_iso = startUTC.toISOString();
                end_time_iso = endUTC.toISOString();
                // Check if current time is between start and end
                videoCallOn = app.type === 'Video Call' && ['Scheduled', 'Rescheduled'].includes(app.status) && dayjs.utc().isAfter(startUTC) && dayjs.utc().isBefore(endUTC);
            }

            return {
                ...app,
                start_time: start_time_iso,
                end_time: end_time_iso,
                videoCallOn,
            };
        }));
        return handleSuccess(res, 200, "en", "APPOINTMENTS_FETCHED", result);
    } catch (error) {
        console.error("Error fetching doctor appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    };
};

export const getMyAppointmentById = async (req, res) => {
    try {
        const doctorId = req?.user?.doctorData?.doctor_id;
        const clinicId = req?.user?.clinicData?.clinic_id;
        const schema = Joi.object({
            appointment_id: Joi.string().required(),
        });
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);
        let { appointment_id } = value;
        const now = dayjs.utc();
        const appointments = clinicId ? await appointmentModel.getAppointmentByAppointmentId(clinicId, appointment_id) : await appointmentModel.getAppointmentByIdForDoctorV2(doctorId, appointment_id);
        const result = await Promise?.all(appointments?.map(async app => {
            if (app.profile_image && !app.profile_image.startsWith('http')) {
                app.profile_image = `${APP_URL}${app.profile_image}`;
            }
            if (app.pdf && !app.pdf.startsWith('http')) {
                app.pdf = `${APP_URL}${app.pdf}`;
            }
            const startUTC = app.start_time ? dayjs.utc(app.start_time) : null;
            const endUTC = app.end_time ? dayjs.utc(app.end_time) : null;
            const videoCallOn = app.type === 'Video Call' && ['Scheduled', 'Rescheduled'].includes(app.status) && now.isAfter(startUTC) && now.isBefore(endUTC);
            const suggestedTreatments = await getTreatmentsByAppointmentId(app.suggested_appointment_id);
            const doctor = await doctorModel.getDocterByDocterId(app.doctor_id);
            let chatId = await chatModel.getChatBetweenUsers(app.user_id, doctor[0].zynq_user_id);
            const treatments = await appointmentModel.getAppointmentTreatments(appointment_id);

            return {
                ...app,
                start_time: startUTC ? startUTC.toISOString() : null,
                end_time: endUTC ? endUTC.toISOString() : null,
                chatId: chatId.length > 0 ? chatId : null,
                videoCallOn,
                treatments,
                suggestedTreatments,
            };

        }));
        return handleSuccess(res, 200, "en", "APPOINTMENTS_FETCHED", result[0]);
    } catch (error) {
        console.error("Error fetching doctor appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const rescheduleAppointment = asyncHandler(async (req, res) => {
    const { doctor_id, appointment_id, start_time, end_time } = req.body;
    const language = req?.user?.language || 'en';
    const existing = await appointmentModel.checkIfSlotAlreadyBooked(doctor_id, start_time);

    if (existing.length > 0) {
        return handleError(res, 400, language, "SLOT_ALREADY_BOOKED");
    }

    const now = new Date();
    const originalStartTime = new Date(start_time);
    // if ((originalStartTime - now) < (60 * 60 * 1000)) {
    //     return handleError(res, 400, "en", "RESCHEDULE_WINDOW_EXPIRED");
    // }


    const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");
    const normalizedEnd = dayjs.utc(end_time).format("YYYY-MM-DD HH:mm:ss");
    const result = await appointmentModel.rescheduleAppointment(
        appointment_id,
        normalizedStart,
        normalizedEnd
    );

    if (result.affectedRows === 0) {
        return handleError(res, 404, language, "APPOINTMENT_NOT_FOUND");
    }

    const [appointmentData] = await appointmentModel.getAppointmentDataByAppointmentID(appointment_id)

    await sendNotification({
        userData: req.user,
        type: "APPOINTMENT",
        type_id: appointment_id,
        notification_type: NOTIFICATION_MESSAGES.appointment_rescheduled,
        receiver_id: appointmentData.user_id,
        receiver_type: "USER"
    });

    return handleSuccess(res, 200, language, "APPOINTMENT_RESCHEDULED_SUCCESSFULLY");
});

// export const getFutureDoctorSlots = asyncHandler(async (req, res) => {
//     const doctor_id = req.user.doctorData.doctor_id;
//     console.log({ doctor_id });
//     const today = dayjs().startOf('day'); // Include all of today
//     const oneMonthLater = today.add(1, 'month');

//     const availabilityRows = await doctorModel.fetchDoctorAvailabilityModel(doctor_id);

//     if (!availabilityRows || availabilityRows.length === 0) {
//         return handleError(res, 400, 'en', "NO_AVAILABILITY_FOUND", []);
//     }

//     let allSlotData = [];

//     for (const availability of availabilityRows) {
//         const rruleDay = weekdayMap[availability.day.toLowerCase()];
//         if (!rruleDay) continue;

//         const rule = new RRule({
//             freq: RRule.WEEKLY,
//             byweekday: [rruleDay],
//             dtstart: today.toDate(),
//             until: oneMonthLater.toDate()
//         });

//         const upcomingDates = rule.all();

//         for (const dateObj of upcomingDates) {
//             const formattedDate = dayjs.utc(dateObj).format('YYYY-MM-DD');

//             const startTime = dayjs(availability.start_time_utc).utc().format('HH:mm');
//             const endTime = dayjs(availability.end_time_utc).utc().format('HH:mm');

//             const slots = generateSlots(
//                 startTime,
//                 endTime,
//                 availability.slot_duration,
//                 formattedDate
//             );

//             slots.forEach(slot => {
//                 allSlotData.push({
//                     date: formattedDate,
//                     day: availability.day.toLowerCase(),
//                     ...slot
//                 });
//             });
//         }
//     }

//     const now = dayjs.utc();

//     const filteredSlotData = allSlotData.filter(slot => {
//         return dayjs.utc(slot.start_time).isAfter(now);
//     });

//     if (filteredSlotData.length === 0) {
//         return handleError(res, 400, 'en', "NO_SLOTS_FOUND", []);
//     }

//     const bookedAppointmentsRaw = await doctorModel.fetchAppointmentsBulkModel(
//         doctor_id,
//         today.format('YYYY-MM-DD'),
//         oneMonthLater.format('YYYY-MM-DD')
//     );

//     const bookedAppointments = (bookedAppointmentsRaw || []).map(app => {
//         const localFormatted = dayjs(app.start_time).format("YYYY-MM-DD HH:mm:ss");
//         const fixedUTC = dayjs.utc(localFormatted).toISOString();
//         return {
//             ...app,
//             start_time: fixedUTC,
//         };
//     });

//     const bookedMap = {};
//     for (const app of bookedAppointments) {
//         bookedMap[app.start_time] = app.count || 1;
//     }

//     const resultWithStatus = filteredSlotData.map(slot => {
//         const status = bookedMap[slot.start_time] > 0 ? 'booked' : 'available';
//         return {
//             start_time: slot.start_time,
//             end_time: slot.end_time,
//             status
//         };
//     });

//     return handleSuccess(res, 200, 'en', "FUTURE_DOCTOR_SLOTS", resultWithStatus);
// });

export const getFutureDoctorSlots = async (req, res) => {
    try {
        const doctor_id = req.user.doctorData.doctor_id;

        const today = dayjs().startOf('day');
        const oneMonthLater = today.add(1, 'month');

        let clinics = await doctorModel.get_clinics_data_by_doctor_id(
            doctor_id
        );

        if (!clinics || clinics.length === 0) {
            return handleError(res, 400, 'en', "CLINIC_NOT_FOUND", []);
        }

        const result = [];

        // 2️⃣ Loop through clinics to generate slots
        await Promise.all(
            clinics.map(async (clinic) => {
                const availabilityRows = await doctorModel.getDoctorSlotSessionsModel(
                    doctor_id,
                    clinic.clinic_id
                );

                const doctorInfo = await doctorModel.getDoctorInfo(
                    doctor_id,
                    clinic.clinic_id
                );

                const fee_per_session = doctorInfo?.fee_per_session || null;

                if (!availabilityRows || availabilityRows.length === 0) return;

                let allSlots = [];

                for (const availability of availabilityRows) {
                    const weekday = availability.day?.toLowerCase();
                    const rruleDay = weekdayMap[weekday];
                    if (!rruleDay) continue;

                    // Generate dates for this weekday
                    const rule = new RRule({
                        freq: RRule.WEEKLY,
                        byweekday: [rruleDay],
                        dtstart: today.toDate(),
                        until: oneMonthLater.toDate()
                    });

                    const dates = rule.all();

                    for (const dateObj of dates) {
                        const dateStr = dayjs.utc(dateObj).format('YYYY-MM-DD');

                        for (const slot of availability.session) {
                            if (!slot?.start_time || !slot?.end_time) continue;

                            const start = dayjs(`${dateStr}T${slot.start_time}Z`);
                            const end = dayjs(`${dateStr}T${slot.end_time}Z`);

                            if (!start.isValid() || !end.isValid()) continue;

                            allSlots.push({
                                start_time: start.toISOString(),
                                end_time: end.toISOString()
                            });
                        }
                    }
                }

                const now = dayjs();
                const futureSlots = allSlots.filter(slot => dayjs(slot.start_time).isAfter(now));

                if (futureSlots.length === 0) return;

                // Fetch booked appointments
                const bookedAppointments = await doctorModel.fetchAppointmentsBulkModel(
                    doctor_id,
                    today.format('YYYY-MM-DD'),
                    oneMonthLater.format('YYYY-MM-DD')
                );

                const bookedMap = {};
                bookedAppointments.forEach(app => {
                    const dt = dayjs(app.start_time);
                    if (!dt.isValid()) return;
                    bookedMap[dt.toISOString()] = true;
                });

                const availableSlots = futureSlots
                    .map(slot => ({
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        status: bookedMap[slot.start_time] ? 'booked' : 'available'
                    }))
                    .filter(slot => slot.status === 'available');

                if (availableSlots.length === 0) return;

                // Sort slots by start_time
                availableSlots.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

                result.push({
                    clinic_id: clinic.clinic_id,
                    clinic_name: clinic.clinic_name,
                    availableSlots
                });
            })
        );

        if (result.length === 0) {
            return handleError(res, 400, 'en', "FUTURE_DOCTOR_SLOTS", []);
        }

        return handleSuccess(res, 200, 'en', "FUTURE_DOCTOR_SLOTS", result);

    } catch (err) {
        console.error('Error fetching future slots:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};


export const getPatientRecords = asyncHandler(async (req, res) => {
    const patientRecords = await appointmentModel.getPatientRecords(req.user);
    return handleSuccess(res, 200, 'en', "PATIENT_RECORDS", patientRecords);
})

export const getSinglePatientRecord = asyncHandler(async (req, res) => {
    const patient_id = req.params.patient_id;
    const patientRecords = await appointmentModel.getSinglePatientRecord(req.user, patient_id);
    return handleSuccess(res, 200, 'en', "PATIENT_RECORD", patientRecords);
})

export const getReviewsAndRatings = asyncHandler(async (req, res) => {
    const reviews = await appointmentModel.getRatings(req.user);
    console.log({ reviews });
    return handleSuccess(res, 200, 'en', "REVIEWS_FETCHED", reviews);
});

export const getDoctorBookedAppointments = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const { user_id, role } = extractUserData(req.user)
    const appointments = await appointmentModel.getDoctorBookedAppointmentsModel(role, user_id);
    const {
        total_clinic_earnings,
        total_admin_earnings,
        total_appointments_earnings
    } = appointments.reduce(
        (acc, appointment) => {
            const clinicEarning = Number(appointment.clinic_earnings) || 0;
            const adminEarning = Number(appointment.admin_earnings) || 0;
            const appointmentEarning = Number(appointment.total_price) || 0;

            acc.total_clinic_earnings += clinicEarning;
            acc.total_admin_earnings += adminEarning;
            acc.total_appointments_earnings += appointmentEarning;

            return acc;
        },
        {
            total_clinic_earnings: 0,
            total_admin_earnings: 0,
            total_appointments_earnings: 0
        }
    );

    const data = {
        total_clinic_earnings: Number(total_clinic_earnings.toFixed(2)) || 0.00,
        total_admin_earnings: Number(total_admin_earnings.toFixed(2)) || 0.00,
        total_appointments_earnings: Number(total_appointments_earnings.toFixed(2)) || 0.00,
        appointments: appointments,
    }
    return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", data);
});

export const addAppointmentDraft = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const doctor_id = req.user.doctorData.doctor_id;
    const { user_id, clinic_id, report_id, discount_type, discount_value, origin_appointment_id, treatments } = req.body;

    let appointment_id = uuidv4();

    // Check if a draft already exists
    const [existingAppointment] = await appointmentModel.getDraftAppointmentData(user_id, doctor_id, clinic_id);

    if (!isEmpty(existingAppointment?.appointment_id)) {
        appointment_id = existingAppointment.appointment_id;

        // Clean up existing draft data for this appointment
        await Promise.all([
            appointmentModel.deleteDraftTreatmentsModel(appointment_id),
            appointmentModel.deleteDraftAppointmentModel(appointment_id),
        ]);
    }

    // Insert fresh draft records
    await Promise.all([
        appointmentModel.insertDraftAppointmentModel(
            appointment_id,
            doctor_id,
            clinic_id,
            user_id,
            report_id,
            discount_type,
            discount_value
        ),
        appointmentModel.insertDraftTreatmentsModel(appointment_id, treatments),
        appointmentModel.insertSuggestedAppointmentModel(origin_appointment_id, appointment_id),
    ]);

    handleSuccess(res, 200, language, "APPOINTMENT_DRAFT_ADDED");

});

// export const getRecommendedTreatmentsForUser = asyncHandler(async (req, res) => {
//     const language = req?.user?.language || 'en';
//     const user_id = req?.params?.user_id;

//     if (isEmpty(user_id)) return handleError(res, 404, language, "USER_NOT_FOUND");

//     const treatmentIDs = await getTreatmentIDsByUserID(user_id)
//     const recommendedTreatments = await getTreatmentsByTreatmentIds(treatmentIDs, language)

//     return handleSuccess(res, 200, language, "TREATMENTS_FETCHED", recommendedTreatments);
// })

export const getRecommendedTreatmentsForUser = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const doctor_id = req?.params?.user_id;

    if (isEmpty(doctor_id)) return handleError(res, 404, language, "DOCTOR_NOT_FOUND");

    // const treatmentIDs = await getTreatmentIDsByUserID(user_id)
    // const recommendedTreatments = await getTreatmentsByTreatmentIds(treatmentIDs, language)
    const recommendedTreatments = await getTreatmentsByTreatmentDoctorId(doctor_id, language); //await getTreatmentsByTreatmentIds(treatmentIDs, language)

    return handleSuccess(res, 200, language, "TREATMENTS_FETCHED", recommendedTreatments);
})