import Joi from 'joi';
import { asyncHandler, handleError, handleSuccess, joiErrorHandle } from '../../utils/responseHandler.js';
import * as appointmentModel from '../../models/appointment.js';
import * as walletModel from '../../models/wallet.js';
import dayjs from 'dayjs';
import { createChat, getChatBetweenUsers } from '../../models/chat.js';
import { fetchFees_per_session_doctor, getDocterByDocterId } from '../../models/doctor.js';
import { formatImagePath } from '../../utils/user_helper.js';
import { getAppointmentDetails, isEmpty } from '../../utils/user_helper.js';
const APP_URL = process.env.APP_URL;
import { v4 as uuidv4 } from 'uuid';
import { NOTIFICATION_MESSAGES, sendNotification } from '../../services/notifications.service.js';
import { getLatestFaceScanReportIDByUserID } from '../../utils/misc.util.js';
import { sendEmail } from '../../services/send_email.js';
import { appointmentBookedTemplate, appointmentBookedTemplateSv, appointmentBookingConfirmationTemplate, appointmentBookingConfirmationTemplateSwedish, appointmentReceiptTemplate, appointmentReceiptTemplateSwedish, appointmentCancelledDoctorTemplate, appointmentCancelledDoctorTemplateSv, appointmentCancelledUserTemplate, appointmentCancelledUserTemplateSv } from '../../utils/templates.js';
import { getAdminCommissionRatesModel } from '../../models/admin.js';
import { createPayLaterSetupIntent, createPayLaterSetupSession, createPaymentSessionForAppointment, createPaymentSessionForAppointmentPAYLATERKLARNA, getOrCreateStripeCustomerId, handleCheckoutSessionCompleted, handlePaymentIntentFailed, handlePaymentIntentSucceeded, handleSetupIntentSucceeded, updateAuthorizationSetupIntentIdOfAppointment, verifyStripeWebhook } from '../../models/payment.js';
import { booleanValidation } from '../../utils/joi.util.js';
import { getIO } from '../../utils/socketManager.js';
import { onlineUsers } from "../../utils/callSocket.js";
import { io, stripe } from '../../../app.js';
import { get_user_by_user_id } from '../../models/api.js';
import { get_clinic_by_id } from '../../models/clinic.js';

export const bookAppointment = async (req, res) => {
    try {
        const schema = Joi.object({
            doctor_id: Joi.string().required(),
            report_id: Joi.string().optional(),
            clinic_id: Joi.string().required(),
            start_time: Joi.string().isoDate().required(),
            end_time: Joi.string().isoDate().required(),
            type: Joi.string().valid("Offline", "Video Call").required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let { doctor_id, start_time, end_time, type, clinic_id, report_id } = value;

        if (isEmpty(report_id)) {
            report_id = await getLatestFaceScanReportIDByUserID(req.user.user_id);
        }

        // Check before inserting (optional, for nicer UX)
        const existing = await appointmentModel.checkIfSlotAlreadyBooked(doctor_id, start_time);
        if (existing.length > 0) {
            return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
        }

        const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");
        const normalizedEnd = dayjs.utc(end_time).format("YYYY-MM-DD HH:mm:ss");

        const appointment_id = uuidv4();
        const appointmentData = {
            appointment_id,
            user_id: req.user.user_id,
            doctor_id,
            start_time: normalizedStart,
            clinic_id,
            report_id: report_id,
            end_time: normalizedEnd,
            type,
            status: 'Scheduled'
        };


        let result = await appointmentModel.insertAppointment(appointmentData);

        let user_id = req.user.user_id
        const doctor = await getDocterByDocterId(doctor_id);
        let chatId = await getChatBetweenUsers(user_id, doctor[0].zynq_user_id);


        await sendNotification({
            userData: req.user,
            type: "APPOINTMENT",
            type_id: appointment_id,
            notification_type: NOTIFICATION_MESSAGES.appointment_booked,
            receiver_id: doctor_id,
            receiver_type: "DOCTOR"
        })

        if (chatId.length > 0) {
            return handleSuccess(res, 201, "en", "APPOINTMENT_BOOKED_SUCCESSFULLY");
        } else {
            let doctorId = doctor[0].zynq_user_id
            let chatCreatedSuccessfully = await createChat(user_id, doctorId);
            if (!chatCreatedSuccessfully.insertId) {
                return handleError(res, 400, 'en', "Failed To Create a chat");
            }
            return handleSuccess(res, 201, "en", "APPOINTMENT_BOOKED_SUCCESSFULLY");
        }
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
        }
        console.error("Error in bookAppointment:", err);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const getMyAppointmentsUser = async (req, res) => {
    try {
        await appointmentModel.updateMissedAppointmentStatusModel();
        const userId = req.user.user_id;
        const appointments = await appointmentModel.getAppointmentsByUserId(userId, 'booked', 'unpaid');

        const now = dayjs.utc();

        const result = await Promise.all(appointments.map(async (app) => {
            const doctor = await getDocterByDocterId(app.doctor_id);
            let chatId = await getChatBetweenUsers(userId, doctor[0]?.zynq_user_id);
            app.chatId = chatId.length > 0 ? chatId[0].id : null;

            const localFormattedStart = app.start_time ? dayjs(app.start_time).format("YYYY-MM-DD HH:mm:ss") : null;
            const localFormattedEnd = app.end_time ? dayjs(app.end_time).format("YYYY-MM-DD HH:mm:ss") : null;

            if (app.profile_image && !app.profile_image.startsWith('http')) {
                app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
            }

            if (app.pdf && !app.pdf.startsWith('http')) {
                app.pdf = `${APP_URL}${app.pdf}`;
            }

            const startUTC = localFormattedStart ? dayjs.utc(localFormattedStart) : null;
            const endUTC = localFormattedEnd ? dayjs.utc(localFormattedEnd) : null;

            // Safe check for video call eligibility
            const videoCallOn = (
                // app.status !== 'Completed' &&
                startUTC?.isValid() &&
                endUTC?.isValid() &&
                now.isAfter(startUTC) &&
                now.isBefore(endUTC)
            );

            const treatments = await appointmentModel.getAppointmentTreatments(app.appointment_id);

            return {
                ...app,
                start_time: startUTC ? startUTC.toISOString() : null,
                end_time: endUTC ? endUTC.toISOString() : null,
                videoCallOn,
                treatments
            };
        }));


        return handleSuccess(res, 200, "en", "APPOINTMENTS_FETCHED", result);
    } catch (error) {
        console.error("Error fetching user appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const updateAppointmentStatus = async (req, res) => {
    try {
        const schema = Joi.object({
            fromApp: booleanValidation.optional().default(false),
            appointment_id: Joi.string().required(),
            status: Joi.string()
                .required()
                .valid("Scheduled", "Completed", "Rescheduled", "Ongoing"),
        });

        const language = req?.user?.language || "en";
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { appointment_id, status, fromApp, receiver_id } = value;

        // 1️⃣ Update appointment status in DB
        const result = await appointmentModel.updateAppointmentStatus(appointment_id, status);
        if (result.affectedRows === 0) {
            return handleError(res, 404, language, "APPOINTMENT_NOT_FOUND");
        }

        // 2️⃣ Trigger socket event when appointment is completed from app
        if (status === "Completed" && fromApp) {
            try {

                const [appointment] = await appointmentModel.getAppointmentDetailsByAppointmentID(appointment_id);

                if (appointment) {
                    const receiver_id = appointment.doctor_zynq_user_id;
                    console.log(`Receiver ID: ${receiver_id}`);
                    // Get the receiver's socketId from onlineUsers map
                    const receiverSocketId = onlineUsers.get(receiver_id.toString());

                    if (receiverSocketId) {
                        io.to(receiverSocketId).emit("appointmentCompleted", {
                            appointment_id,
                            message: "Appointment has been completed by the app user.",
                            fromUser: appointment.user_id,
                            toUser: appointment.doctor_id,
                            user_id: appointment.user_id,
                            clinic_id: appointment.clinic_id,
                            report_id: appointment.report_id,
                            doctor_id: appointment.doctor_id
                        });
                        console.log(`Socket event sent to user ${receiver_id} for appointment ${appointment_id}`);
                    } else {
                        console.log(`Receiver ${receiver_id} is not online.`);
                    }
                }
            } catch (err) {
                console.error("Socket emit error:", err);
            }
        }

        return handleSuccess(res, 200, language, "APPOINTMENT_STATUS_UPDATED");
    } catch (error) {
        console.error("Error updating appointment status:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};


export const getAppointmentsById = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const language = req?.user?.language || "en";

        // ----------------- Validate input -----------------
        const schema = Joi.object({
            appointment_id: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { appointment_id } = value;

        // ----------------- Fetch appointment -----------------
        const appointments = await appointmentModel.getAppointmentsById(userId, appointment_id, language);

        if (!appointments.length) {
            return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", null);
        }

        const now = dayjs.utc();
        // ----------------- Prepare draft appointments -----------------
        const rawDrafts = await appointmentModel.getDraftAppointmentsByDoctorId(appointment_id, appointments[0].doctor_id, "draft", "unpaid");

        let draftTreatments = [];
        for (const draft of rawDrafts) {
            const treatments = await appointmentModel.getAppointmentTreatments(draft.appointment_id, language);
            draftTreatments.push(...treatments);
        }

        // Remove duplicates if same treatment appears in multiple drafts
        draftTreatments = draftTreatments.filter(
            (t, index, self) =>
                index === self.findIndex((x) => x.treatment_id === t.treatment_id)
        );

        // ----------------- Map appointment data -----------------
        const result = await Promise.all(
            appointments.map(async (app) => {
                const doctor = await getDocterByDocterId(app.doctor_id);
                if (!doctor?.length || !doctor[0]?.zynq_user_id) {
                    const notFoundError = new Error("Doctor not found");
                    notFoundError.statusCode = 404;
                    notFoundError.errorKey = "DOCTOR_NOT_FOUND";
                    throw notFoundError;
                }

                const clinic = await get_clinic_by_id(app.clinic_id);
                if (!clinic?.length) {
                    const notFoundError = new Error("Clinic not found");
                    notFoundError.statusCode = 404;
                    notFoundError.errorKey = "CLINIC_NOT_FOUND";
                    throw notFoundError;
                }

                const chatId = await getChatBetweenUsers(userId, doctor[0].zynq_user_id);

                app.chatId = chatId.length > 0 ? chatId[0].id : null;

                const localFormattedStart = app.start_time ? dayjs(app.start_time).format("YYYY-MM-DD HH:mm:ss") : null;
                const localFormattedEnd = app.end_time ? dayjs(app.end_time).format("YYYY-MM-DD HH:mm:ss") : null;

                if (app.profile_image && !app.profile_image.startsWith("http")) {
                    app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
                }

                if (app.pdf && !app.pdf.startsWith("http")) {
                    app.pdf = `${APP_URL}${app.pdf}`;
                }

                const startUTC = localFormattedStart ? dayjs.utc(localFormattedStart) : null;
                const endUTC = localFormattedEnd ? dayjs.utc(localFormattedEnd) : null;

                const videoCallOn = now.isAfter(startUTC) && now.isBefore(endUTC);

                const treatments = await appointmentModel.getAppointmentTreatments(appointment_id, language);

                return {
                    ...app,
                    start_time: localFormattedStart ? dayjs.utc(localFormattedStart).toISOString() : null,
                    end_time: localFormattedEnd ? dayjs.utc(localFormattedEnd).toISOString() : null,
                    videoCallOn,
                    treatments,
                    draftAppointments: draftTreatments
                };
            })
        );

        // ----------------- Send single appointment response -----------------
        return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", result[0]);

    } catch (error) {
        if (error?.statusCode === 404 && error?.errorKey) {
            return handleError(res, 404, req?.user?.language || "en", error.errorKey);
        }
        console.error("Error fetching appointment by ID:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const rateAppointment = asyncHandler(async (req, res) => {
    const { appointment_id, rating, review } = req.body;

    const language = req?.user?.language || 'en';

    const appointmentData = await appointmentModel.getAppointmentDataByAppointmentID(appointment_id);

    if (isEmpty(appointmentData)) {
        return handleError(res, 404, language, "APPOINTMENT_NOT_FOUND");
    }
    const result = await appointmentModel.insertAppointmentRating(
        { appointment_id, clinic_id: appointmentData[0].clinic_id, doctor_id: appointmentData[0].doctor_id, user_id: req.user.user_id, rating, review }
    );

    if (result.affectedRows === 0) {
        return handleError(res, 404, language, "ERROR_RATING_APPOINTMENT");
    }

    return handleSuccess(res, 200, language, "APPOINTMENT_RATED_SUCCESSFULLY");
});

export const saveOrBookAppointment = async (req, res) => {
    try {

        const schema = Joi.object({
            appointment_id: Joi.string().optional(),
            doctor_id: Joi.string().required(),
            report_id: Joi.string().optional(),
            clinic_id: Joi.string().required(),
            treatments: Joi.array().items(
                Joi.object({
                    treatment_id: Joi.string().required(),
                    price: Joi.number().required()
                })
            ).optional(),
            start_time: Joi.string().isoDate().optional(),
            end_time: Joi.string().isoDate().optional()
        });


        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let {
            appointment_id: inputId,
            doctor_id,
            clinic_id,
            treatments = [],
            start_time,
            end_time,
            report_id
        } = value;

        const user_id = req.user.user_id;
        const hasTreatments = treatments.length > 0;
        const appointmentType = hasTreatments ? 'Clinic Visit' : 'Video Call';
        const save_type = hasTreatments
            ? start_time && end_time
                ? 'booked'
                : 'draft'
            : 'booked';

        const appointment_id = inputId || uuidv4();
        const total_price = treatments.reduce((sum, t) => sum + t.price, 0);
        if (isEmpty(report_id)) {
            report_id = await getLatestFaceScanReportIDByUserID(req.user.user_id);
        }
        const normalizedStart = start_time
            ? dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss")
            : null;
        const normalizedEnd = end_time
            ? dayjs.utc(end_time).format("YYYY-MM-DD HH:mm:ss")
            : null;

        const [{ APPOINTMENT_COMMISSION }] = await getAdminCommissionRatesModel();
        const ADMIN_EARNING_PERCENTAGE = APPOINTMENT_COMMISSION || 3;
        const admin_earnings = Number(((total_price * ADMIN_EARNING_PERCENTAGE) / 100).toFixed(2));
        const clinic_earnings = Number(total_price) - admin_earnings;
        const is_paid = total_price > 0 ? 1 : 0;

        const appointmentData = {
            appointment_id,
            user_id,
            doctor_id,
            clinic_id,
            total_price,
            admin_earnings,
            clinic_earnings,
            report_id: report_id,
            type: appointmentType,
            status: save_type === 'booked' ? 'Scheduled' : 'Scheduled',
            save_type,
            start_time: normalizedStart,
            end_time: normalizedEnd,
            is_paid
        };


        if (inputId) {
            await appointmentModel.updateAppointment(appointmentData);
            if (hasTreatments) {
                await appointmentModel.deleteAppointmentTreatments(appointment_id);
                await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
            }
        } else {
            await appointmentModel.insertAppointment(appointmentData);
            if (hasTreatments) {
                await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
            }
        }

        let chat_id = 0;
        const appointmentDetails = await getAppointmentDetails(user_id, appointment_id)
        if (save_type == 'booked') {
            let user_id = req.user.user_id
            const doctor = await getDocterByDocterId(doctor_id);
            let chatId = await getChatBetweenUsers(user_id, doctor[0].zynq_user_id);
            const selectedAppointmentBookedTemplate = (req?.user?.language || "en") === "sv"
                ? appointmentBookedTemplateSv
                : appointmentBookedTemplate;


            await sendNotification({
                userData: req.user,
                type: "APPOINTMENT",
                type_id: appointment_id,
                notification_type: NOTIFICATION_MESSAGES.appointment_booked,
                receiver_id: doctor_id,
                receiver_type: "DOCTOR"
            })


            await sendEmail({
                to: doctor[0].email,
                subject: selectedAppointmentBookedTemplate.subject({
                    user_name: req?.user?.full_name,
                    appointment_date: normalizedStart
                }),
                html: selectedAppointmentBookedTemplate.body({
                    user_name: req?.user?.full_name,
                    doctor_name: doctor[0].name,
                    appointment_date: normalizedStart,
                    total_price: total_price,
                    clinic_name: appointmentDetails.clinic_name,
                }),
            });

            if (chatId.length < 1) {
                let doctorId = doctor[0].zynq_user_id
                let chatCreatedSuccessfully = await createChat(user_id, doctorId);
                chat_id = chatCreatedSuccessfully.insertId
            }


            else {
                chat_id = chatId[0].id
            }
        }
        const language = req?.user?.language || 'en';



        return handleSuccess(
            res,
            201,
            language,

            save_type === 'booked' ? 'APPOINTMENT_BOOKED_SUCCESSFULLY' : 'DRAFT_SAVED_SUCCESSFULLY',
            { appointment_id, chat_id, appointmentDetails: appointmentDetails }
        );
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
        }
        console.error("Error in saveOrBookAppointment:", err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const getMyTreatmentPlans = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const language = req?.user?.language || 'en';
        const appointments = await appointmentModel.getAppointmentsByUserIdV2(userId, 'draft', 'unpaid');

        const now = dayjs.utc();

        const result = await Promise.all(appointments.map(async (app) => {
            const doctor = await getDocterByDocterId(app.doctor_id);
            let chatId = await getChatBetweenUsers(userId, doctor[0].zynq_user_id);
            app.chatId = chatId.length > 0 ? chatId[0].id : null;

            const localFormattedStart = app.start_time ? dayjs(app.start_time).format("YYYY-MM-DD HH:mm:ss") : null;
            const localFormattedEnd = app.end_time ? dayjs(app.end_time).format("YYYY-MM-DD HH:mm:ss") : null;

            if (app.profile_image && !app.profile_image.startsWith('http')) {
                app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
            }

            if (app.pdf && !app.pdf.startsWith('http')) {
                app.pdf = `${APP_URL}${app.pdf}`;
            }


            const startUTC = localFormattedStart ? dayjs.utc(localFormattedStart) : null;
            const endUTC = localFormattedEnd ? dayjs.utc(localFormattedEnd) : null;
            //const videoCallOn = now.isAfter(startUTC) && now.isBefore(endUTC);
            const videoCallOn =
                app.status !== 'Completed'
            now.isAfter(startUTC) &&
                now.isBefore(endUTC);

            const treatments = await appointmentModel.getAppointmentTreatments(app.appointment_id, language);

            return {
                ...app,
                start_time: localFormattedStart ? dayjs.utc(localFormattedStart).toISOString() : null,
                end_time: localFormattedEnd ? dayjs.utc(localFormattedEnd).toISOString() : null,
                videoCallOn,
                treatments
            };
        }));

        return handleSuccess(res, 200, "en", "APPOINTMENTS_FETCHED", result);
    } catch (error) {
        console.error("Error fetching user appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const getBookedAppointments = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const appointments = await appointmentModel.getBookedAppointmentsByUserId(userId, 'booked');
        const total_spent = appointments.reduce((acc, appointment) => acc + Number(appointment.total_price), 0);
        const data = {
            total_spent: Number(total_spent.toFixed(2)) || 0.00,
            appointments: appointments,
        }
        return handleSuccess(res, 200, "en", "APPOINTMENTS_FETCHED", data);
    } catch (error) {
        console.error("Error fetching user appointments:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const requestCallback = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const doctor_id = req.params.doctor_id;

    sendNotification({
        userData: req.user,
        type: "CALLBACK",
        type_id: doctor_id,
        notification_type: NOTIFICATION_MESSAGES.callback_requested,
        receiver_id: doctor_id,
        receiver_type: "DOCTOR"
    })

    return handleSuccess(res, 200, language, "CALLBACK_REQUESTED_SUCCESSFULLY");
})

export const cancelAppointment = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';
        const { appointment_id, reason } = req.body;
        const schema = Joi.object({
            appointment_id: Joi.string().required(),
            reason: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const user_id = req.user.user_id;


        const appointmentDetails = await appointmentModel.getAppointmentsById(user_id, appointment_id);
        const appointment = appointmentDetails[0]
        if (!appointment) return handleError(res, 404, language, "APPOINTMENT_NOT_FOUND");
        if (appointment.user_id !== user_id) return handleError(res, 404, language, "NOT_ALLOWED");


        const startTime = new Date(appointment.start_time);
        const now = new Date();
        const diffHours = (startTime - now) / (1000 * 60 * 60); // Convert ms → hours
        if (diffHours < 24) {
            return handleError(res, 400, language, "CANCELLATION_NOT_ALLOWED_WITHIN_24_HOURS");
        }

        // if (appointment.is_paid) {
        //     return handleError(res, 404, language, "NOT_ALLOWED");
        // }


        await appointmentModel.cancelAppointment(appointment_id, {
            status: 'Cancelled',
            cancelled_by: 'user',
            cancelled_by_id: user_id,
            cancel_reason: reason,
            payment_status: appointment.is_paid ? 'refund_initiated' : appointment.payment_status
        });

        handleSuccess(res, 200, language, 'APPOINTMENT_CANCELLED_SUCCESSFULLY');

        await sendNotification({
            userData: req.user,
            type: "APPOINTMENT",
            type_id: appointment_id,
            notification_type: NOTIFICATION_MESSAGES.appointment_cancelled,
            receiver_id: appointment.doctor_id,
            receiver_type: "DOCTOR"
        })

        try {
            const [doctor] = await getDocterByDocterId(appointment.doctor_id);
            const fullAppointmentDetails = await getAppointmentDetails(user_id, appointment_id);

            const clinicName = fullAppointmentDetails?.clinic_name || "";
            const appointmentDateTime = appointment.start_time;

            const selectedAppointmentCancelledDoctorTemplate = language === "sv"
                ? appointmentCancelledDoctorTemplateSv
                : appointmentCancelledDoctorTemplate;

            const selectedAppointmentCancelledUserTemplate = language === "sv"
                ? appointmentCancelledUserTemplateSv
                : appointmentCancelledUserTemplate;

            if (doctor?.email) {
                await sendEmail({
                    to: doctor.email,
                    subject: selectedAppointmentCancelledDoctorTemplate.subject({
                        user_name: req.user.full_name,
                        appointment_date: appointmentDateTime,
                    }),
                    html: selectedAppointmentCancelledDoctorTemplate.body({
                        user_name: req.user.full_name,
                        doctor_name: doctor.name,
                        appointment_date: appointmentDateTime,
                        clinic_name: clinicName,
                    }),
                });
            }

            if (req.user?.email) {
                await sendEmail({
                    to: req.user.email,
                    subject: selectedAppointmentCancelledUserTemplate.subject({
                        doctor_name: doctor?.name || "",
                        appointment_date: appointmentDateTime,
                    }),
                    html: selectedAppointmentCancelledUserTemplate.body({
                        user_name: req.user.full_name,
                        doctor_name: doctor?.name || "",
                        appointment_date: appointmentDateTime,
                        clinic_name: clinicName,
                    }),
                });
            }
        } catch (emailErr) {
            console.error("Error sending cancellation email:", emailErr);
        }
    } catch (err) {
        console.error(err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const getMyWallet = async (req, res) => {
    try {
        const { wallet, transactions } = await walletModel.getWalletWithTx(req.user.user_id, 1000, 0);
        return handleSuccess(res, 200, 'en', 'WALLET_SUMMARY', { wallet, transactions });
    } catch (err) {
        console.error('getMyWallet error:', err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

// export const saveAppointmentAsDraft = async (req, res) => {
//     try {

//         const schema = Joi.object({
//             appointment_id: Joi.string().optional(),
//             doctor_id: Joi.string().required(),
//             report_id: Joi.string().optional(),
//             clinic_id: Joi.string().required(),
//             treatments: Joi.array().items(
//                 Joi.object({
//                     treatment_id: Joi.string().required(),
//                     price: Joi.number().optional(),
//                     sub_treatments: Joi.array().items(
//                         Joi.object({
//                             sub_treatment_id: Joi.string().required(),
//                             sub_treatment_price: Joi.number().required()
//                         })
//                     ).optional()
//                 })
//             ).min(1).required(),
//         });


//         const { error, value } = schema.validate(req.body);
//         if (error) return joiErrorHandle(res, error);

//         let {
//             appointment_id: existingAppointmentId,
//             doctor_id,
//             clinic_id,
//             treatments = [],
//             report_id
//         } = value;

//         const user_id = req.user.user_id;
//         const hasTreatments = treatments.length > 0;
//         const appointmentType = hasTreatments ? 'Clinic Visit' : 'Video Call';
//         const save_type = 'draft'

//         let appointment_id = existingAppointmentId || uuidv4();
//         console.log("appointment_id - ", appointment_id)
//         const total_price = treatments.reduce((sum, t) => sum + t.price, 0);
//         if (isEmpty(report_id)) {
//             report_id = await getLatestFaceScanReportIDByUserID(req.user.user_id);
//         }

//         const is_paid = 0;
//         const payment_status = 'unpaid';

//         const appointmentData = {
//             appointment_id,
//             user_id,
//             doctor_id,
//             clinic_id,
//             total_price,
//             admin_earnings: 0,
//             clinic_earnings: 0,
//             report_id: report_id,
//             type: appointmentType,
//             status: 'Scheduled',
//             save_type,
//             start_time: null,
//             end_time: null,
//             is_paid,
//             payment_status
//         };

//         const appointmentResponse = await appointmentModel.getAppointmentsByUserIdAndDoctorId(user_id, doctor_id, save_type)

//         if (existingAppointmentId || appointmentResponse.length > 0) {
//             if (appointmentResponse.length > 0) {
//                 appointment_id = appointmentResponse[0].appointment_id
//                 appointmentData.appointment_id = appointment_id
//             }
//             const result = await appointmentModel.updateAppointmentV2(appointmentData);
//             if (hasTreatments) {
//                 await appointmentModel.deleteAppointmentTreatments(appointment_id);
//                 await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
//             }
//         } else {
//             const result = await appointmentModel.insertAppointment(appointmentData);
//             if (hasTreatments) {
//                 await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
//             }
//         }

//         let chat_id = 0;
//         const appointmentDetails = await getAppointmentDetails(user_id, appointment_id)
//         const language = req?.user?.language || 'en';

//         return handleSuccess(
//             res,
//             201,
//             language, 'DRAFT_SAVED_SUCCESSFULLY',
//             { appointment_id, chat_id, appointmentDetails: appointmentDetails }
//         );
//     } catch (err) {
//         if (err.code === 'ER_DUP_ENTRY') {
//             return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
//         }
//         console.error("Error in saveOrBookAppointment:", err);
//         return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
//     }
// };

export const saveAppointmentAsDraft = async (req, res) => {
    try {
        const schema = Joi.object({
            appointment_id: Joi.string().optional(),
            doctor_id: Joi.string().required(),
            report_id: Joi.string().optional(),
            clinic_id: Joi.string().required(),
            treatments: Joi.array().items(
                Joi.object({
                    treatment_id: Joi.string().required(),
                    price: Joi.number().optional(),
                    sub_treatments: Joi.array().items(
                        Joi.object({
                            sub_treatment_id: Joi.string().required(),
                            sub_treatment_price: Joi.number().required()
                        })
                    ).optional()
                })
            ).min(1).required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let {
            appointment_id: existingAppointmentId,
            doctor_id,
            clinic_id,
            treatments = [],
            report_id
        } = value;

        const user_id = req.user.user_id;
        const save_type = "draft";
        let appointment_id = existingAppointmentId || uuidv4();

        // ---------------- PRICE CALCULATION (updated same as bookDirect) ----------------
        let total_price = 0;

        for (const t of treatments) {
            // add parent treatment price if exists
            total_price += +t.price || 0;

            // add sub treatment price
            if (Array.isArray(t.sub_treatments)) {
                for (const st of t.sub_treatments) {
                    total_price += +st.sub_treatment_price || 0;
                }
            }
        }

        // ---------------- Report ID fix ----------------
        if (isEmpty(report_id)) {
            report_id = await getLatestFaceScanReportIDByUserID(user_id);
        }

        const is_paid = 0;
        const payment_status = "unpaid";

        const appointmentData = {
            appointment_id,
            user_id,
            doctor_id,
            clinic_id,
            total_price,
            admin_earnings: 0,
            clinic_earnings: 0,
            report_id,
            type: treatments.length > 0 ? "Clinic Visit" : "Video Call",
            status: "Scheduled",
            save_type,
            start_time: null,
            end_time: null,
            is_paid,
            payment_status
        };

        // ---------------- Fetch existing draft ----------------
        const existingDraft = await appointmentModel.getAppointmentsByUserIdAndDoctorId(
            user_id,
            doctor_id,
            save_type
        );

        // ---------------- Update OR Insert ----------------
        if (existingAppointmentId || existingDraft.length > 0) {
            if (existingDraft.length > 0) {
                appointment_id = existingDraft[0].appointment_id;
                appointmentData.appointment_id = appointment_id;
            }

            await appointmentModel.updateAppointmentV2(appointmentData);

            // Replace all treatment rows
            await appointmentModel.deleteAppointmentTreatments(appointment_id);
            await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);

        } else {
            await appointmentModel.insertAppointment(appointmentData);

            if (treatments.length > 0) {
                await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
            }
        }

        // ---------------- Response ----------------
        const appointmentDetails = await getAppointmentDetails(user_id, appointment_id);
        const language = req?.user?.language || "en";

        return handleSuccess(
            res,
            201,
            language,
            "DRAFT_SAVED_SUCCESSFULLY",
            {
                appointment_id,
                chat_id: 0,
                appointmentDetails
            }
        );

    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
        }

        console.error("Error in saveAppointmentAsDraft:", err);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

// export const bookDirectAppointment = asyncHandler(async (req, res) => {
//     try {
//         // ---------------- Validation ----------------
//         const schema = Joi.object({
//             appointment_id: Joi.string().optional(),
//             doctor_id: Joi.string().required(),
//             report_id: Joi.string().optional(),
//             clinic_id: Joi.string().required(),
//             treatments: Joi.array().items(
//                 Joi.object({
//                     treatment_id: Joi.string().required(),
//                     price: Joi.number().min(0).required().allow(null),
//                 })
//             ).optional(),
//             concerns: Joi.array().items(Joi.string()).optional(),
//             start_time: Joi.string().isoDate().required(),
//             end_time: Joi.string().isoDate().required(),
//             redirect_url: Joi.string().required(),
//             cancel_url: Joi.string().required(),
//             appointmentType: Joi.string().required()

//         });

//         const { error, value } = schema.validate(req.body);
//         if (error) return joiErrorHandle(res, error);

//         let {
//             appointment_id: inputId,
//             doctor_id,
//             clinic_id,
//             treatments = [],
//             start_time,
//             end_time,
//             report_id,
//             redirect_url,
//             cancel_url,
//             appointmentType,
//             concerns = []
//         } = value;

//         const user_id = req.user.user_id;
//         const hasTreatments = treatments.length > 0;
//         // const appointmentType = hasTreatments ? "Clinic Visit" : "Video Call";
//         const save_type = "booked";
//         const appointment_id = inputId || uuidv4();

//         if (!isEmpty(concerns)) {
//             await appointmentModel.updateAppointmentConcerns(appointment_id, concerns);
//         }

//         // ---------------- Compute Base Price ----------------
//         let total_price = treatments.reduce((sum, t) => sum + t.price, 0);
//         const normalizedStart = start_time
//             ? dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss")
//             : null;

//         const normalizedEnd = end_time
//             ? dayjs.utc(end_time).format("YYYY-MM-DD HH:mm:ss")
//             : null;

//         if (isEmpty(report_id)) {
//             report_id = await getLatestFaceScanReportIDByUserID(user_id);
//         }

//         // ---------------- Load Commission & VAT ----------------
//         const [{ APPOINTMENT_COMMISSION }] = await getAdminCommissionRatesModel();
//         const ADMIN_EARNING_PERCENTAGE = APPOINTMENT_COMMISSION || 3;
//         const VAT_PERCENTAGE = 25; // Adjust if Sweden VAT changes

//         // ---------------- Discount & VAT Logic ----------------
//         let discounted_amount = 0;
//         let subtotal = total_price;
//         let vat_amount = 0;
//         let final_total = total_price;

//         let existingData = null;

//         if (inputId) {
//             [existingData] = await appointmentModel.getAppointmentDetailsByAppointmentID(appointment_id);

//             if (!existingData) {
//                 return handleError(res, 404, "en", "APPOINTMENT_NOT_FOUND");
//             }

//             const { discount_type = "NO_DISCOUNT", discount_value = 0 } = existingData;

//             if (discount_type !== "NO_DISCOUNT") {
//                 if (discount_type === "PERCENTAGE") {
//                     discounted_amount = +((total_price * discount_value) / 100).toFixed(2);
//                 } else if (discount_type === "SEK") {
//                     discounted_amount = +discount_value;
//                 }
//                 subtotal = Math.max(0, total_price - discounted_amount);
//             }
//         }

//         // ✅ VAT applies on the discounted subtotal (if any)
//         vat_amount = +(subtotal * (VAT_PERCENTAGE / 100)).toFixed(2);
//         final_total = +(subtotal + vat_amount).toFixed(2);

//         // ---------------- Earnings ----------------
//         let admin_earnings = +((subtotal * ADMIN_EARNING_PERCENTAGE) / 100).toFixed(2);
//         admin_earnings = +(admin_earnings + vat_amount).toFixed(2); // VAT goes to admin
//         let clinic_earnings = +(subtotal - admin_earnings).toFixed(2);

//         const is_paid = final_total > 0 ? 1 : 0;

//         // ---------------- Appointment Data ----------------
//         const appointmentData = {
//             appointment_id,
//             user_id,
//             doctor_id,
//             clinic_id,
//             subtotal,
//             vat_amount,
//             total_price: final_total,
//             admin_earnings,
//             clinic_earnings,
//             report_id,
//             type: appointmentType,
//             status: "Scheduled",
//             save_type,
//             start_time: normalizedStart,
//             end_time: normalizedEnd,
//             is_paid,
//             payment_status: is_paid ? "unpaid" : "paid",
//         };

//         // ---------------- Save or Update ----------------
//         if (inputId) {
//             if (existingData?.discount_type !== "NO_DISCOUNT") {
//                 appointmentData.total_price_with_discount = total_price;
//                 appointmentData.discounted_amount = discounted_amount;
//                 await appointmentModel.updateAppointmentV3(appointmentData);
//             } else {
//                 await appointmentModel.updateAppointment(appointmentData);
//             }

//             if (hasTreatments) {
//                 await appointmentModel.deleteAppointmentTreatments(appointment_id);
//                 await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
//             }
//         } else {
//             await appointmentModel.insertAppointment(appointmentData);
//             if (hasTreatments) {
//                 await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
//             }
//         }

//         // ---------------- Handle Paid or Free ----------------
//         const language = req?.user?.language || "en";

//         if (is_paid) {
//             // 💰 Create Klarna Payment Session
//             const session = await createPaymentSessionForAppointment({
//                 payment_gateway: "KLARNA",
//                 metadata: {
//                     order_lines: [
//                         {
//                             name: "Appointment",
//                             quantity: 1,
//                             unit_amount: final_total * 100,
//                         },
//                     ],
//                     appointment_id,
//                     redirect_url,
//                     cancel_url,
//                 },
//             });

//             return handleSuccess(res, 200, "en", "SESSION_CREATED_SUCCESSFULLY", session);
//         } else {
//             // 🔔 Notify Doctor + Send Email
//             const appointmentDetails = await getAppointmentDetails(user_id, appointment_id);
//             const [doctor] = await getDocterByDocterId(doctor_id);

//             await sendNotification({
//                 userData: req.user,
//                 type: "APPOINTMENT",
//                 type_id: appointment_id,
//                 notification_type: NOTIFICATION_MESSAGES.appointment_booked,
//                 receiver_id: doctor_id,
//                 receiver_type: "DOCTOR",
//             });

//             await sendEmail({
//                 to: doctor.email,
//                 subject: appointmentBookedTemplate.subject({
//                     user_name: req.user.full_name,
//                     appointment_date: normalizedStart,
//                 }),
//                 html: appointmentBookedTemplate.body({
//                     user_name: req.user.full_name,
//                     doctor_name: doctor.name,
//                     appointment_date: normalizedStart,
//                     total_price: final_total,
//                     clinic_name: appointmentDetails.clinic_name,
//                 }),
//             });

//             // 💬 Ensure chat exists
//             const chatCheck = await getChatBetweenUsers(user_id, doctor.zynq_user_id);
//             let chat_id = chatCheck.length ? chatCheck[0].id : (await createChat(user_id, doctor.zynq_user_id)).insertId;

//             return handleSuccess(res, 201, language, "APPOINTMENT_BOOKED_SUCCESSFULLY", {
//                 appointment_id,
//                 chat_id,
//                 appointmentDetails,
//             });
//         }
//     } catch (err) {
//         if (err.code === "ER_DUP_ENTRY") {
//             return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
//         }
//         console.error("Error in bookDirectAppointment:", err);
//         return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
//     }
// });

// export const bookDirectAppointment_081225 = asyncHandler(async (req, res) => {
//     try {
//         // ---------------- Validation ----------------
//         const schema = Joi.object({
//             appointment_id: Joi.string().optional(),
//             doctor_id: Joi.string().required(),
//             report_id: Joi.string().optional(),
//             clinic_id: Joi.string().required(),
//             treatments: Joi.array().items(
//                 Joi.object({
//                     treatment_id: Joi.string().required(),
//                     price: Joi.number().optional(),
//                     sub_treatments: Joi.array().items(
//                         Joi.object({
//                             sub_treatment_id: Joi.string().required(),
//                             sub_treatment_price: Joi.number().required()
//                         })
//                     ).optional()
//                 })
//             ).optional(),
//             concerns: Joi.array().items(Joi.string()).optional(),
//             start_time: Joi.string().isoDate().required(),
//             end_time: Joi.string().isoDate().required(),
//             redirect_url: Joi.string().required(),
//             cancel_url: Joi.string().required(),
//             appointmentType: Joi.string().required()
//         });

//         const { error, value } = schema.validate(req.body);
//         if (error) return joiErrorHandle(res, error);

//         let {
//             appointment_id: inputId,
//             doctor_id,
//             clinic_id,
//             treatments = [],
//             start_time,
//             end_time,
//             report_id,
//             redirect_url,
//             cancel_url,
//             appointmentType,
//             concerns = []
//         } = value;

//         const user_id = req.user.user_id;
//         const save_type = "booked";
//         const appointment_id = inputId || uuidv4();

//         if (!isEmpty(concerns)) {
//             await appointmentModel.updateAppointmentConcerns(appointment_id, concerns);
//         }

//         // ---------------- PRICE CALCULATION ----------------
//         // let total_price = 0;
//         // for (const t of treatments) {
//         //     total_price += +t.price || 0;

//         //     if (Array.isArray(t.sub_treatments)) {
//         //         for (const st of t.sub_treatments) {
//         //             total_price += +st.sub_treatment_price || 0;
//         //         }
//         //     }
//         // }
//         let total_price = 0;
//         for (const t of treatments) {
//             if (Array.isArray(t.sub_treatments) && t.sub_treatments.length > 0) {
//                 for (const st of t.sub_treatments) {
//                     total_price += +st.sub_treatment_price || 0;
//                 }
//             }
//             else {
//                 // No sub-treatments → use main treatment price
//                 total_price += +t.price || 0;
//             }
//         }
//         // ---------------- Normalize Times ----------------
//         const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");
//         const normalizedEnd = dayjs.utc(end_time).format("YYYY-MM-DD HH:mm:ss");

//         if (!report_id) {
//             report_id = await getLatestFaceScanReportIDByUserID(user_id);
//         }

//         // ---------------- Load Commission & VAT ----------------
//         const [{ APPOINTMENT_COMMISSION }] = await getAdminCommissionRatesModel();
//         const ADMIN_EARNING_PERCENTAGE = APPOINTMENT_COMMISSION || 3;
//         const VAT_PERCENTAGE = 25;

//         // ---------------- Discount & VAT Logic ----------------
//         let discounted_amount = 0;
//         let subtotal = total_price;
//         let vat_amount = 0;
//         let final_total = total_price;

//         let existingData = null;

//         if (inputId) {
//             [existingData] = await appointmentModel.getAppointmentDetailsByAppointmentID(appointment_id);

//             if (!existingData) {
//                 return handleError(res, 404, "en", "APPOINTMENT_NOT_FOUND");
//             }

//             const { discount_type = "NO_DISCOUNT", discount_value = 0 } = existingData;

//             if (discount_type !== "NO_DISCOUNT") {
//                 if (discount_type === "PERCENTAGE") {
//                     discounted_amount = +((total_price * discount_value) / 100).toFixed(2);
//                 } else if (discount_type === "SEK") {
//                     discounted_amount = +discount_value;
//                 }

//                 subtotal = Math.max(0, total_price - discounted_amount);
//             }
//         }

//         vat_amount = +(subtotal * (VAT_PERCENTAGE / 100)).toFixed(2);
//         final_total = +(subtotal + vat_amount).toFixed(2);

//         let admin_earnings = +((subtotal * ADMIN_EARNING_PERCENTAGE) / 100).toFixed(2);
//         admin_earnings = +(admin_earnings + vat_amount).toFixed(2);

//         let clinic_earnings = +(subtotal - admin_earnings).toFixed(2);

//         const is_paid = final_total > 0 ? 1 : 0;

//         // ---------------- Appointment Data ----------------
//         const appointmentData = {
//             appointment_id,
//             user_id,
//             doctor_id,
//             clinic_id,
//             subtotal,
//             vat_amount,
//             total_price: final_total,
//             admin_earnings,
//             clinic_earnings,
//             report_id,
//             type: appointmentType,
//             status: "Scheduled",
//             save_type,
//             start_time: normalizedStart,
//             end_time: normalizedEnd,
//             is_paid,
//             payment_status: is_paid ? "unpaid" : "paid",
//         };

//         // ---------------- SAVE OR UPDATE APPOINTMENT ----------------
//         if (inputId) {
//             if (existingData?.discount_type !== "NO_DISCOUNT") {
//                 appointmentData.total_price_with_discount = total_price;
//                 appointmentData.discounted_amount = discounted_amount;
//                 await appointmentModel.updateAppointmentV3(appointmentData);
//             } else {
//                 await appointmentModel.updateAppointment(appointmentData);
//             }

//             await appointmentModel.deleteAppointmentTreatments(appointment_id);
//         } else {
//             await appointmentModel.insertAppointment(appointmentData);
//         }

//         // ---------------- INSERT TREATMENTS (MODEL HANDLES LOGIC) ----------------
//         if (treatments.length > 0) {
//             await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
//         }

//         // ---------------- PAYMENT OR FREE ----------------
//         const language = req?.user?.language || "en";

//         if (is_paid) {
//             const session = await createPaymentSessionForAppointment({
//                 payment_gateway: "KLARNA",
//                 metadata: {
//                     order_lines: [
//                         {
//                             name: "Appointment",
//                             quantity: 1,
//                             unit_amount: final_total * 100,
//                         },
//                     ],
//                     appointment_id,
//                     redirect_url,
//                     cancel_url,
//                 },
//             });

//             return handleSuccess(res, 200, "en", "SESSION_CREATED_SUCCESSFULLY", session);
//         }

//         // ---------------- FREE APPOINTMENT ----------------
//         const appointmentDetails = await getAppointmentDetails(user_id, appointment_id);
//         const [doctor] = await getDocterByDocterId(doctor_id);

//         await sendNotification({
//             userData: req.user,
//             type: "APPOINTMENT",
//             type_id: appointment_id,
//             notification_type: NOTIFICATION_MESSAGES.appointment_booked,
//             receiver_id: doctor_id,
//             receiver_type: "DOCTOR",
//         });

//         await sendEmail({
//             to: doctor.email,
//             subject: appointmentBookedTemplate.subject({
//                 user_name: req.user.full_name,
//                 appointment_date: normalizedStart,
//             }),
//             html: appointmentBookedTemplate.body({
//                 user_name: req.user.full_name,
//                 doctor_name: doctor.name,
//                 appointment_date: normalizedStart,
//                 total_price: final_total,
//                 clinic_name: appointmentDetails.clinic_name,
//             }),
//         });

//         const chatCheck = await getChatBetweenUsers(user_id, doctor.zynq_user_id);
//         let chat_id = chatCheck.length ? chatCheck[0].id : (await createChat(user_id, doctor.zynq_user_id)).insertId;

//         return handleSuccess(res, 201, language, "APPOINTMENT_BOOKED_SUCCESSFULLY", {
//             appointment_id,
//             chat_id,
//             appointmentDetails,
//         });

//     } catch (err) {
//         if (err.code === "ER_DUP_ENTRY") {
//             return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
//         }
//         console.error("Error in bookDirectAppointment:", err);
//         return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
//     }
// });


// export const bookDirectAppointment = asyncHandler(async (req, res) => {
//     try {
//         // ---------------- Validation ----------------
//         const schema = Joi.object({
//             appointment_id: Joi.string().optional(),
//             doctor_id: Joi.string().required(),
//             report_id: Joi.string().optional(),
//             clinic_id: Joi.string().required(),
//             treatments: Joi.array().items(
//                 Joi.object({
//                     treatment_id: Joi.string().required(),
//                     price: Joi.number().optional(),
//                     sub_treatments: Joi.array().items(
//                         Joi.object({
//                             sub_treatment_id: Joi.string().required(),
//                             sub_treatment_price: Joi.number().required()
//                         })
//                     ).optional()
//                 })
//             ).optional(),
//             concerns: Joi.array().items(Joi.string()).optional(),
//             start_time: Joi.string().isoDate().required(),
//             end_time: Joi.string().isoDate().required(),
//             redirect_url: Joi.string().required(),
//             cancel_url: Joi.string().required(),
//             appointmentType: Joi.string().required(),
//             payment_timing: Joi.string().optional().valid('PAY_NOW', 'PAY_LATER', 'PAY_LATER_KLARNA'),
//         });

//         const { error, value } = schema.validate(req.body);
//         if (error) return joiErrorHandle(res, error);

//         let {
//             appointment_id: inputId,
//             doctor_id,
//             clinic_id,
//             treatments = [],
//             start_time,
//             end_time,
//             report_id,
//             redirect_url,
//             cancel_url,
//             appointmentType,
//             concerns = [],
//             payment_timing
//         } = value;

//         const user_id = req.user.user_id;
//         const language = req?.user?.language || "en";
//         const save_type = "booked";
//         const appointment_id = inputId || uuidv4();

//         if (!isEmpty(concerns)) {
//             await appointmentModel.updateAppointmentConcerns(appointment_id, concerns);
//         }

//         // ---------------- PRICE CALCULATION ----------------
//         let total_price = 0;
//         for (const t of treatments) {
//             if (Array.isArray(t.sub_treatments) && t.sub_treatments.length > 0) {
//                 for (const st of t.sub_treatments) {
//                     total_price += +st.sub_treatment_price || 0;
//                 }
//             } else {
//                 total_price += +t.price || 0;
//             }
//         }

//         // ---------------- Normalize Times ----------------
//         const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");
//         const normalizedEnd = dayjs.utc(end_time).format("YYYY-MM-DD HH:mm:ss");

//         if (!report_id) {
//             report_id = await getLatestFaceScanReportIDByUserID(user_id);
//         }

//         // ---------------- Load Commission & VAT ----------------
//         const [{ APPOINTMENT_COMMISSION }] = await getAdminCommissionRatesModel();
//         const ADMIN_EARNING_PERCENTAGE = APPOINTMENT_COMMISSION || 3;
//         const VAT_PERCENTAGE = 25;

//         // ---------------- Discount & VAT Logic ----------------
//         let discounted_amount = 0;
//         let subtotal = total_price;
//         let vat_amount = 0;
//         let final_total = total_price;

//         let existingData = null;

//         if (inputId) {
//             [existingData] = await appointmentModel.getAppointmentDetailsByAppointmentID(appointment_id);

//             if (!existingData) {
//                 return handleError(res, 404, language, "APPOINTMENT_NOT_FOUND");
//             }

//             const { discount_type = "NO_DISCOUNT", discount_value = 0 } = existingData;

//             if (discount_type !== "NO_DISCOUNT") {
//                 if (discount_type === "PERCENTAGE") {
//                     discounted_amount = +((total_price * discount_value) / 100).toFixed(2);
//                 } else if (discount_type === "SEK") {
//                     discounted_amount = +discount_value;
//                 }

//                 subtotal = Math.max(0, total_price - discounted_amount);
//             }
//         }


//         // vat_amount = +(subtotal * (VAT_PERCENTAGE / 100)).toFixed(2);
//         // final_total = +(subtotal + vat_amount).toFixed(2);

//         // let admin_earnings = +((subtotal * ADMIN_EARNING_PERCENTAGE) / 100).toFixed(2);
//         // admin_earnings = +(admin_earnings + vat_amount).toFixed(2);

//         // let clinic_earnings = +(subtotal - admin_earnings).toFixed(2);

//         // ---------------- NO VAT Logic ----------------
//         const appointmentDetails = await getAppointmentDetails(user_id, appointment_id);
//         const [doctor] = await getDocterByDocterId(doctor_id);

//         vat_amount = 0;
//         final_total = subtotal === 0 ? doctor.fee_per_session : subtotal;

//         let admin_earnings = +((subtotal * ADMIN_EARNING_PERCENTAGE) / 100).toFixed(2);
//         let clinic_earnings = +(subtotal - admin_earnings).toFixed(2);

//         const is_paid = final_total > 0 ? 1 : 0;

//         // ---------------- Appointment Data ----------------
//         const appointmentData = {
//             appointment_id,
//             user_id,
//             doctor_id,
//             clinic_id,
//             subtotal,
//             vat_amount,
//             total_price: final_total,
//             admin_earnings,
//             clinic_earnings,
//             report_id,
//             type: appointmentType,
//             status: "Scheduled",
//             save_type,
//             start_time: normalizedStart,
//             end_time: normalizedEnd,
//             is_paid,
//             payment_status: is_paid ? "unpaid" : "paid",
//             payment_timing: payment_timing ? payment_timing : "PAY_NOW",
//         };

//         if (inputId) {
//             if (existingData?.discount_type !== "NO_DISCOUNT") {
//                 appointmentData.total_price_with_discount = total_price;
//                 appointmentData.discounted_amount = discounted_amount;
//                 await appointmentModel.updateAppointmentV3(appointmentData);
//             } else {
//                 await appointmentModel.updateAppointment(appointmentData);
//             }

//             await appointmentModel.deleteAppointmentTreatments(appointment_id);
//         } else {
//             await appointmentModel.insertAppointment(appointmentData);
//         }

//         if (treatments.length > 0) {
//             await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
//         }

//         let session = null;
//         // ---------------- PAYMENT SECTION (UPDATED) ----------------
//         if (is_paid && appointmentType === "Clinic Visit" && final_total != 0) {
//             if (payment_timing === 'PAY_LATER') {

//                 const stripe_customer_id = await getOrCreateStripeCustomerId(user_id);

//                 session = await createPayLaterSetupSession({
//                     metadata: {
//                         appointment_id,
//                         redirect_url,
//                         cancel_url,
//                         stripe_customer_id: stripe_customer_id
//                     }
//                 });

//                 const updateStatus = await updateAuthorizationSetupIntentIdOfAppointment(session.setup_intent, appointment_id);

//             } else if (payment_timing === 'PAY_LATER_KLARNA') {

//                 session = await createPaymentSessionForAppointmentPAYLATERKLARNA({
//                     metadata: {
//                         order_lines: [
//                             {
//                                 name: "Appointment",
//                                 quantity: 1,
//                                 unit_amount: final_total * 100,
//                             },
//                         ],
//                         appointment_id,
//                         redirect_url,
//                         cancel_url,
//                         currency: "sek",
//                     },
//                 });
//             } else {
//                 session = await createPaymentSessionForAppointment({
//                     metadata: {
//                         order_lines: [
//                             {
//                                 name: "Appointment",
//                                 quantity: 1,
//                                 unit_amount: final_total * 100,
//                             },
//                         ],
//                         appointment_id,
//                         redirect_url,
//                         cancel_url,
//                         currency: "sek",
//                     },
//                 });
//             }

//             return handleSuccess(res, 200, language, "SESSION_CREATED_SUCCESSFULLY", session);
//         }

//         // ---------------- FREE APPOINTMENT FLOW ----------------
//         const newAppointmentDetails = await getAppointmentDetails(user_id, appointment_id);
//         // const [doctor] = await getDocterByDocterId(doctor_id);

//         if (is_paid && appointmentType === "Video Call" && final_total != 0) {

//             let session;

//             if (payment_timing === 'PAY_LATER') {


//                 const stripe_customer_id = await getOrCreateStripeCustomerId(user_id);

//                 session = await createPayLaterSetupSession({
//                     metadata: {
//                         appointment_id,
//                         redirect_url,
//                         cancel_url,
//                         stripe_customer_id: stripe_customer_id
//                     }
//                 });

//                 const updateStatus = await updateAuthorizationSetupIntentIdOfAppointment(session.setup_intent, appointment_id);

//             } else {
//                 session = await createPaymentSessionForAppointment({
//                     metadata: {
//                         order_lines: [
//                             {
//                                 name: "Appointment",
//                                 quantity: 1,
//                                 unit_amount: final_total * 100,
//                             },
//                         ],
//                         appointment_id,
//                         redirect_url,
//                         cancel_url,
//                         currency: "sek",
//                     },
//                 });
//             }

//             return handleSuccess(res, 200, language, "SESSION_CREATED_SUCCESSFULLY", session);
//         }

//         await sendNotification({
//             userData: req.user,
//             type: "APPOINTMENT",
//             type_id: appointment_id,
//             notification_type: NOTIFICATION_MESSAGES.appointment_booked,
//             receiver_id: doctor_id,
//             receiver_type: "DOCTOR",
//         });

//         await sendEmail({
//             to: doctor.email,
//             subject: appointmentBookedTemplate.subject({
//                 user_name: req.user.full_name,
//                 appointment_date: normalizedStart,
//             }),
//             html: appointmentBookedTemplate.body({
//                 user_name: req.user.full_name,
//                 doctor_name: doctor.name,
//                 appointment_date: normalizedStart,
//                 total_price: final_total == 0 ? "Free" : final_total,
//                 clinic_name: newAppointmentDetails.clinic_name,
//             }),
//         });

//         const chatCheck = await getChatBetweenUsers(user_id, doctor.zynq_user_id);
//         let chat_id = chatCheck.length ? chatCheck[0].id : (await createChat(user_id, doctor.zynq_user_id)).insertId;

//         return handleSuccess(res, 201, language, "APPOINTMENT_BOOKED_SUCCESSFULLY", {
//             appointment_id,
//             chat_id,
//             appointmentDetails: newAppointmentDetails,
//         });

//     } catch (err) {
//         if (err.code === "ER_DUP_ENTRY") {
//             return handleError(res, 400, 'en', "SLOT_ALREADY_BOOKED");
//         }
//         console.error("Error in bookDirectAppointment:", err);
//         return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
//     }
// });

export const bookDirectAppointment = asyncHandler(async (req, res) => {
    try {
        // ---------------- Validation ----------------
        const schema = Joi.object({
            appointment_id: Joi.string().optional(),
            doctor_id: Joi.string().required(),
            report_id: Joi.string().optional(),
            clinic_id: Joi.string().required(),
            treatments: Joi.array().items(
                Joi.object({
                    treatment_id: Joi.string().required(),
                    price: Joi.number().optional(),
                    sub_treatments: Joi.array().items(
                        Joi.object({
                            sub_treatment_id: Joi.string().required(),
                            sub_treatment_price: Joi.number().required()
                        })
                    ).optional()
                })
            ).optional(),
            concerns: Joi.array().items(Joi.string()).optional(),
            start_time: Joi.string().isoDate().required(),
            end_time: Joi.string().isoDate().required(),
            redirect_url: Joi.string().required(),
            cancel_url: Joi.string().required(),
            appointmentType: Joi.string().required(),
            payment_timing: Joi.string().optional().valid('PAY_NOW', 'PAY_LATER', 'PAY_LATER_KLARNA'),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let {
            appointment_id: inputId,
            doctor_id,
            clinic_id,
            treatments = [],
            start_time,
            end_time,
            report_id,
            redirect_url,
            cancel_url,
            appointmentType,
            concerns = [],
            payment_timing
        } = value;

        const user_id = req.user.user_id;
        const language = req?.user?.language || "en";
        const save_type = "booked";
        const appointment_id = inputId || uuidv4();

        if (!isEmpty(concerns)) {
            await appointmentModel.updateAppointmentConcerns(appointment_id, concerns);
        }

        // ---------------- PRICE CALCULATION ----------------
        let total_price = 0;
        for (const t of treatments) {
            if (Array.isArray(t.sub_treatments) && t.sub_treatments.length > 0) {
                for (const st of t.sub_treatments) {
                    total_price += +st.sub_treatment_price || 0;
                }
            } else {
                total_price += +t.price || 0;
            }
        }

        const isAllTreatmentsFree =
            appointmentType === "Clinic Visit" &&
            treatments.length > 0 &&
            treatments.every(t =>
                (+t.price || 0) === 0 &&
                (
                    !t.sub_treatments ||
                    t.sub_treatments.length === 0 ||
                    t.sub_treatments.every(st => (+st.sub_treatment_price || 0) === 0)
                )
            );

        // ---------------- Normalize Times ----------------
        const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");
        const normalizedEnd = dayjs.utc(end_time).format("YYYY-MM-DD HH:mm:ss");

        if (!report_id) {
            report_id = await getLatestFaceScanReportIDByUserID(user_id);
        }

        // ---------------- Load Commission & VAT ----------------
        const [{ APPOINTMENT_COMMISSION }] = await getAdminCommissionRatesModel();
        const ADMIN_EARNING_PERCENTAGE = APPOINTMENT_COMMISSION || 3;
        const VAT_PERCENTAGE = 25;

        // ---------------- Discount & VAT Logic ----------------
        let discounted_amount = 0;
        let subtotal = total_price;
        let vat_amount = 0;
        let final_total = total_price;

        let existingData = null;

        if (inputId) {
            [existingData] = await appointmentModel.getAppointmentDetailsByAppointmentID(appointment_id);

            if (!existingData) {
                return handleError(res, 404, language, "APPOINTMENT_NOT_FOUND");
            }

            const { discount_type = "NO_DISCOUNT", discount_value = 0 } = existingData;

            if (discount_type !== "NO_DISCOUNT") {
                if (discount_type === "PERCENTAGE") {
                    discounted_amount = +((total_price * discount_value) / 100).toFixed(2);
                } else if (discount_type === "SEK") {
                    discounted_amount = +discount_value;
                }

                subtotal = Math.max(0, total_price - discounted_amount);
            }
        }


        // vat_amount = +(subtotal * (VAT_PERCENTAGE / 100)).toFixed(2);
        // final_total = +(subtotal + vat_amount).toFixed(2);

        // let admin_earnings = +((subtotal * ADMIN_EARNING_PERCENTAGE) / 100).toFixed(2);
        // admin_earnings = +(admin_earnings + vat_amount).toFixed(2);

        // let clinic_earnings = +(subtotal - admin_earnings).toFixed(2);

        // ---------------- NO VAT Logic ----------------
        const appointmentDetails = await getAppointmentDetails(user_id, appointment_id);
        let [doctor] = await getDocterByDocterId(doctor_id);
        if (doctor.role === 'DOCTOR') {
            let data = await fetchFees_per_session_doctor(doctor_id, clinic_id);
            doctor.fee_per_session = data.fee_per_session
        }
        vat_amount = 0;
        final_total = subtotal === 0 ? doctor.fee_per_session : subtotal;
        let admin_earnings = +((subtotal * ADMIN_EARNING_PERCENTAGE) / 100).toFixed(2);
        let clinic_earnings = +(subtotal - admin_earnings).toFixed(2);

        const is_paid = final_total > 0 ? 1 : 0;
        console.log('final_total>>>>', final_total);

        // ---------------- Appointment Data ----------------
        const appointmentData = {
            appointment_id,
            user_id,
            doctor_id,
            clinic_id,
            subtotal,
            vat_amount,
            total_price: final_total,
            admin_earnings,
            clinic_earnings,
            report_id,
            type: appointmentType,
            status: "Scheduled",
            save_type,
            start_time: normalizedStart,
            end_time: normalizedEnd,
            is_paid,
            payment_status: is_paid ? "unpaid" : "paid",
            payment_timing: payment_timing ? payment_timing : "PAY_NOW",
        };

        if (inputId) {
            if (existingData?.discount_type !== "NO_DISCOUNT") {
                appointmentData.total_price_with_discount = total_price;
                appointmentData.discounted_amount = discounted_amount;
                await appointmentModel.updateAppointmentV3(appointmentData);
            } else {
                await appointmentModel.updateAppointment(appointmentData);
            }

            await appointmentModel.deleteAppointmentTreatments(appointment_id);
        } else {
            await appointmentModel.insertAppointment(appointmentData);
        }

        if (treatments.length > 0) {
            await appointmentModel.insertAppointmentTreatments(appointment_id, treatments);
        }

        let session = null;
        // ---------------- PAYMENT SECTION (UPDATED) ----------------

        if (is_paid && appointmentType === "Clinic Visit" && final_total != 0 && isAllTreatmentsFree === false) {
            if (payment_timing === 'PAY_LATER') {
                const stripe_customer_id = await getOrCreateStripeCustomerId(user_id);
                session = await createPayLaterSetupSession({
                    metadata: {
                        appointment_id,
                        redirect_url,
                        cancel_url,
                        stripe_customer_id: stripe_customer_id
                    }, final_total
                });

                const updateStatus = await updateAuthorizationSetupIntentIdOfAppointment(session.setup_intent, appointment_id);

                // -----------------------------new flow developing with setup intent--------------------------karan patel---//

                // const stripeCustomerId = await getOrCreateStripeCustomerId(user_id);
                // const paymentMethods = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card" });
                // const hasSavedCard = paymentMethods.data.length > 0;
                // if (hasSavedCard) {
                //     const paymentIntent = await stripe.paymentIntents.create({
                //         amount: final_total * 100,
                //         currency: "sek",
                //         customer: stripeCustomerId,
                //         payment_method: paymentMethods.data[0].id,
                //         off_session: true,
                //         confirm: true,
                //         metadata: {
                //             appointment_id,
                //             payment_flow: "PAY_LATER_AUTO_CHARGE"
                //         }
                //     });
                //     session = paymentIntent.id
                // } else {
                //     const setupIntent = await stripe.setupIntents.create({
                //         customer: stripeCustomerId,
                //         payment_method_types: ["card"],
                //         usage: "off_session",
                //         metadata: {
                //             appointment_id,
                //             amount_to_charge: final_total,
                //             payment_flow: "PAY_LATER_SAVE_AND_CHARGE"
                //         }
                //     });

                //     await updateAuthorizationSetupIntentIdOfAppointment(setupIntent.id, appointment_id);
                //     session = setupIntent.client_secret
                // }
                // -----------------------------------end----------------------------------------------//

            } else if (payment_timing === 'PAY_LATER_KLARNA') {
                session = await createPaymentSessionForAppointmentPAYLATERKLARNA({
                    metadata: {
                        order_lines: [
                            {
                                name: "Appointment",
                                quantity: 1,
                                unit_amount: final_total * 100,
                            },
                        ],
                        appointment_id,
                        redirect_url,
                        cancel_url,
                        currency: "sek",
                    },
                });
            } else {
                session = await createPaymentSessionForAppointment({
                    metadata: {
                        order_lines: [
                            {
                                name: "Appointment",
                                quantity: 1,
                                unit_amount: final_total * 100,
                            },
                        ],
                        appointment_id,
                        redirect_url,
                        cancel_url,
                        currency: "sek",
                    },
                });
            }

            return handleSuccess(res, 200, language, "SESSION_CREATED_SUCCESSFULLY", session);
        }


        // ---------------- FREE APPOINTMENT FLOW ----------------
        let newAppointmentDetails = await getAppointmentDetails(user_id, appointment_id);
        if (is_paid && appointmentType === "Video Call" && final_total != 0 && doctor.fee_per_session !== 0) {
            let session;
            if (payment_timing === 'PAY_LATER') {
                const stripe_customer_id = await getOrCreateStripeCustomerId(user_id);

                session = await createPayLaterSetupSession({
                    metadata: {
                        appointment_id,
                        redirect_url,
                        cancel_url,
                        stripe_customer_id: stripe_customer_id
                    }, final_total
                });

                const updateStatus = await updateAuthorizationSetupIntentIdOfAppointment(session.setup_intent, appointment_id);

            } else if (payment_timing === 'PAY_LATER_KLARNA') {
                session = await createPaymentSessionForAppointmentPAYLATERKLARNA({
                    metadata: {
                        order_lines: [
                            {
                                name: "Appointment",
                                quantity: 1,
                                unit_amount: final_total * 100,
                            },
                        ],
                        appointment_id,
                        redirect_url,
                        cancel_url,
                        currency: "sek",
                        final_total
                    },
                });
            } else {
                session = await createPaymentSessionForAppointment({
                    metadata: {
                        order_lines: [
                            {
                                name: "Appointment",
                                quantity: 1,
                                unit_amount: final_total * 100,
                            },
                        ],
                        appointment_id,
                        redirect_url,
                        cancel_url,
                        currency: "sek",
                    },
                });
            }

            return handleSuccess(res, 200, language, "SESSION_CREATED_SUCCESSFULLY", session);
        }

        await sendNotification({
            userData: req.user,
            type: "APPOINTMENT",
            type_id: appointment_id,
            notification_type: NOTIFICATION_MESSAGES.appointment_booked,
            receiver_id: doctor_id,
            receiver_type: "DOCTOR",
        });

        const selectedAppointmentBookedTemplate = language === "sv"
            ? appointmentBookedTemplateSv
            : appointmentBookedTemplate;

        await sendEmail({
            to: doctor.email,
            subject: selectedAppointmentBookedTemplate.subject({
                user_name: req.user.full_name,
                appointment_date: normalizedStart,
            }),
            html: selectedAppointmentBookedTemplate.body({
                user_name: req.user.full_name,
                doctor_name: doctor.name,
                appointment_date: normalizedStart,
                total_price: final_total == 0 ? "Free" : final_total,
                clinic_name: newAppointmentDetails.clinic_name,
            }),
        });

        const buildEmptyCheckoutSession = ({
            id: null,
            object: "checkout.session",
            adaptive_pricing: null,
            after_expiration: null,
            allow_promotion_codes: null,
            amount_subtotal: 0,
            amount_total: 0,
            automatic_tax: null,
            billing_address_collection: null,
            branding_settings: null,
            cancel_url: null,
            client_reference_id: null,
            client_secret: null,
            collected_information: null,
            consent: null,
            consent_collection: null,
            created: null,
            currency: null,
            currency_conversion: null,
            custom_fields: [],
            custom_text: null,
            customer: null,
            customer_account: null,
            customer_creation: null,
            customer_details: null,
            customer_email: null,
            discounts: [],
            expires_at: null,
            invoice: null,
            invoice_creation: null,
            livemode: false,
            locale: null,
            metadata: {},
            mode: null,
            origin_context: null,
            payment_intent: null,
            payment_link: null,
            payment_method_collection: null,
            payment_method_configuration_details: null,
            payment_method_options: null,
            payment_method_types: [],
            payment_status: null,
            permissions: null,
            phone_number_collection: null,
            recovered_from: null,
            saved_payment_method_options: null,
            setup_intent: null,
            shipping_address_collection: null,
            shipping_cost: null,
            shipping_options: [],
            status: null,
            submit_type: null,
            subscription: null,
            success_url: null,
            total_details: {
                amount_discount: 0,
                amount_shipping: 0,
                amount_tax: 0
            },
            ui_mode: null,
            url: null,
            wallet_options: null,
            appointmentDetails: newAppointmentDetails,
            chat_id: 0,
            appointment_id: appointment_id,
        });
        if (appointmentType === "Clinic Visit" && isAllTreatmentsFree) {
            return handleSuccess(res, 200, language, "SESSION_CREATED_SUCCESSFULLY",
                buildEmptyCheckoutSession
            );
        }

        if (appointmentType === "Video Call" && doctor.fee_per_session === 0) {
            return handleSuccess(res, 200, language, "SESSION_CREATED_SUCCESSFULLY",
                buildEmptyCheckoutSession
            );
        }
        const chatCheck = await getChatBetweenUsers(user_id, doctor.zynq_user_id);
        let chat_id = chatCheck.length ? chatCheck[0].id : (await createChat(user_id, doctor.zynq_user_id)).insertId;

        return handleSuccess(res, 201, language, "APPOINTMENT_BOOKED_SUCCESSFULLY", {
            appointment_id,
            chat_id,
            appointmentDetails: newAppointmentDetails,
        });

    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return handleError(res, 400, 'en', "SLOT_ALREADY_BOOKED");
        }
        console.error("Error in bookDirectAppointment:", err);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
});


// export const markAppointmentAsPaid = async (req, res) => {
//     try {

//         const schema = Joi.object({
//             appointment_id: Joi.string().required(),
//         });


//         const { error, value } = schema.validate(req.body);
//         if (error) return joiErrorHandle(res, error);

//         let {
//             appointment_id
//         } = value;


//         const language = req?.user?.language || 'en';


//         let chat_id = 0;
//         let user_id = req.user.user_id;
//         const appointmentDetails = await getAppointmentDetails(user_id, appointment_id);
//         const doctor_id = appointmentDetails.doctor_id;
//         const start_time = appointmentDetails.start_time;
//         const total_price = appointmentDetails.total_price
//         const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");

//         if (appointmentDetails.payment_timing != "PAY_LATER") {
//             await appointmentModel.updateAppointmentAsPaid(appointment_id, 'paid');
//         }

//         const doctor = await getDocterByDocterId(doctor_id);
//         let chatId = await getChatBetweenUsers(user_id, doctor[0].zynq_user_id);

//         await sendNotification({
//             userData: req.user,
//             type: "APPOINTMENT",
//             type_id: appointment_id,
//             notification_type: NOTIFICATION_MESSAGES.appointment_booked,
//             receiver_id: doctor_id,
//             receiver_type: "DOCTOR"
//         })


//         await sendEmail({
//             to: doctor[0].email,
//             subject: appointmentBookedTemplate.subject({
//                 user_name: req?.user?.full_name,
//                 appointment_date: normalizedStart
//             }),
//             html: appointmentBookedTemplate.body({
//                 user_name: req?.user?.full_name,
//                 doctor_name: doctor[0].name,
//                 appointment_date: normalizedStart,
//                 total_price: total_price,
//                 clinic_name: appointmentDetails.clinic_name,
//             }),
//         });

//         if (chatId.length < 1) {
//             let doctorId = doctor[0].zynq_user_id
//             let chatCreatedSuccessfully = await createChat(user_id, doctorId);
//             chat_id = chatCreatedSuccessfully.insertId
//         }
//         else {
//             chat_id = chatId[0].id
//         }


//         const appointments = await appointmentModel.getAppointmentsById(user_id, appointment_id, language);

//         const result = await Promise.all(
//             appointments.map(async (app) => {
//                 const doctor = await getDocterByDocterId(app.doctor_id);

//                 if (app.profile_image && !app.profile_image.startsWith("http")) {
//                     app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
//                 }

//                 if (app.pdf && !app.pdf.startsWith("http")) {
//                     app.pdf = `${APP_URL}${app.pdf}`;
//                 }

//                 const treatments = await appointmentModel.getAppointmentTreatments(appointment_id, language);

//                 return {
//                     ...app,
//                     treatments,
//                 };
//             })
//         );

//         // ----------------- Send single appointment response -----------------
//         // return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", result[0]);
//         const data = result[0];


//         const [totalAppointmentBooked] = await appointmentModel.getNumberOfAppointments(user_id);
//         const formattedAppointmentCount = formatAppointmentCount(totalAppointmentBooked.count);


//         if (language == "en") {

//             await sendEmail({
//                 to: req.user.email,
//                 subject: appointmentBookingConfirmationTemplate.subject(data.payment_timing),
//                 html: appointmentBookingConfirmationTemplate.body({
//                     doctor_image: data.profile_image ? data.profile_image : `${APP_URL}/default_doctor_img.jpg`,
//                     doctor_name: `${appointments[0]?.name} ${appointments[0]?.last_name ? appointments[0]?.last_name : ""}`,
//                     clinic_name: data.clinic_name,
//                     visit_link: "#",
//                     refund_policy: "This appointment can be cancelled and will be fully refunded up to  24 hours before the schedule time.",
//                     subtotal: data.total_price ? `SEK ${data.total_price}` : "SEK 0.00",
//                     vat_amount: data.total_price ? `SEK ${(data.total_price - (data.total_price / 1.25)).toFixed(2)}` : "SEK 0.00",
//                     vat_percentage: (() => {
//                         const total = parseFloat(data.total_price) || 0;
//                         const vat = parseFloat(data.vat_amount) || 0;
//                         const base = total - vat;

//                         return base > 0 ? `${Math.round((vat / base) * 100)}` : "0";
//                     })(),

//                     treatments: data.treatments,
//                     start_time: formatDate(data.start_time),
//                     end_time: formatDate(data.end_time),
//                     order_number: `${generateOrderNumber(data.start_time)}${formattedAppointmentCount}`,
//                     payment_timing: data.payment_timing
//                 }),
//             });
//         } else {

//             await sendEmail({
//                 to: req.user.email,
//                 subject: appointmentBookingConfirmationTemplateSwedish.subject(data.payment_timing),
//                 html: appointmentBookingConfirmationTemplateSwedish.body({
//                     doctor_image: data.profile_image ? data.profile_image : `${APP_URL}/default_doctor_img.jpg`,
//                     doctor_name: `${appointments[0]?.name} ${appointments[0]?.last_name ? appointments[0]?.last_name : ""}`,
//                     clinic_name: data.clinic_name,
//                     visit_link: "#",
//                     refund_policy: "Denna bokade tid kan avbokas och återbetalas i sin helhet upp till 24 timmar före den schemalagda tiden.",
//                     subtotal: data.total_price ? `SEK ${data.total_price}` : "SEK 0.00",
//                     vat_amount: data.total_price ? `SEK ${(data.total_price - (data.total_price / 1.25))}` : "SEK 0.00",
//                     vat_percentage: (() => {
//                         const total = parseFloat(data.total_price) || 0;
//                         const vat = parseFloat(data.vat_amount) || 0;
//                         const base = total - vat;

//                         return base > 0 ? `${Math.round((vat / base) * 100)}` : "0";
//                     })(),

//                     treatments: data.treatments,
//                     start_time: formatDate(data.start_time),
//                     end_time: formatDate(data.end_time),
//                     order_number: `${generateOrderNumber(data.start_time)}${formattedAppointmentCount}`,
//                     payment_timing: data.payment_timing
//                 }),
//             });
//         }


//         return handleSuccess(
//             res,
//             201,
//             language,
//             'APPOINTMENT_BOOKED_SUCCESSFULLY',
//             { appointment_id, chat_id, appointmentDetails: appointmentDetails }
//         );
//     }





//     catch (err) {
//         if (err.code === 'ER_DUP_ENTRY') {
//             return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
//         }
//         console.error("Error in saveOrBookAppointment:", err);
//         return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
//     }
// };

export const markAppointmentAsPaid = async (req, res) => {
    try {

        const schema = Joi.object({
            appointment_id: Joi.string().required(),
        });


        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let {
            appointment_id
        } = value;


        const language = req?.user?.language || 'en';


        let chat_id = 0;
        let user_id = req.user.user_id;
        const appointmentDetails = await getAppointmentDetails(user_id, appointment_id);
        const doctor_id = appointmentDetails.doctor_id;
        const start_time = appointmentDetails.start_time;
        const total_price = appointmentDetails.total_price
        const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");

        // if (appointmentDetails.payment_timing != "PAY_LATER") {
        //     await appointmentModel.updateAppointmentAsPaid(appointment_id, 'paid');
        // }

        const doctor = await getDocterByDocterId(doctor_id);
        let chatId = await getChatBetweenUsers(user_id, doctor[0].zynq_user_id);

        // await sendNotification({
        //     userData: req.user,
        //     type: "APPOINTMENT",
        //     type_id: appointment_id,
        //     notification_type: NOTIFICATION_MESSAGES.appointment_booked,
        //     receiver_id: doctor_id,
        //     receiver_type: "DOCTOR"
        // })


        // await sendEmail({
        //     to: doctor[0].email,
        //     subject: appointmentBookedTemplate.subject({
        //         user_name: req?.user?.full_name,
        //         appointment_date: normalizedStart
        //     }),
        //     html: appointmentBookedTemplate.body({
        //         user_name: req?.user?.full_name,
        //         doctor_name: doctor[0].name,
        //         appointment_date: normalizedStart,
        //         total_price: total_price,
        //         clinic_name: appointmentDetails.clinic_name,
        //     }),
        // });

        if (chatId.length < 1) {
            let doctorId = doctor[0].zynq_user_id
            let chatCreatedSuccessfully = await createChat(user_id, doctorId);
            chat_id = chatCreatedSuccessfully.insertId
        }
        else {
            chat_id = chatId[0].id
        }


        const appointments = await appointmentModel.getAppointmentsById(user_id, appointment_id, language);

        // const result = await Promise.all(
        //     appointments.map(async (app) => {
        //         const doctor = await getDocterByDocterId(app.doctor_id);

        //         if (app.profile_image && !app.profile_image.startsWith("http")) {
        //             app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
        //         }

        //         if (app.pdf && !app.pdf.startsWith("http")) {
        //             app.pdf = `${APP_URL}${app.pdf}`;
        //         }

        //         const treatments = await appointmentModel.getAppointmentTreatments(appointment_id, language);

        //         return {
        //             ...app,
        //             treatments,
        //         };
        //     })
        // );

        // ----------------- Send single appointment response -----------------
        // return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", result[0]);
        // const data = result[0];


        const [totalAppointmentBooked] = await appointmentModel.getNumberOfAppointments(user_id);
        const formattedAppointmentCount = formatAppointmentCount(totalAppointmentBooked.count);


        // if (language == "en") {

        //     await sendEmail({
        //         to: req.user.email,
        //         subject: appointmentBookingConfirmationTemplate.subject(data.payment_timing),
        //         html: appointmentBookingConfirmationTemplate.body({
        //             doctor_image: data.profile_image ? data.profile_image : `${APP_URL}/default_doctor_img.jpg`,
        //             doctor_name: `${appointments[0]?.name} ${appointments[0]?.last_name ? appointments[0]?.last_name : ""}`,
        //             clinic_name: data.clinic_name,
        //             visit_link: "#",
        //             refund_policy: "This appointment can be cancelled and will be fully refunded up to  24 hours before the schedule time.",
        //             subtotal: data.total_price ? `SEK ${data.total_price}` : "SEK 0.00",
        //             vat_amount: data.total_price ? `SEK ${(data.total_price - (data.total_price / 1.25)).toFixed(2)}` : "SEK 0.00",
        //             vat_percentage: (() => {
        //                 const total = parseFloat(data.total_price) || 0;
        //                 const vat = parseFloat(data.vat_amount) || 0;
        //                 const base = total - vat;

        //                 return base > 0 ? `${Math.round((vat / base) * 100)}` : "0";
        //             })(),

        //             treatments: data.treatments,
        //             start_time: formatDate(data.start_time),
        //             end_time: formatDate(data.end_time),
        //             order_number: `${generateOrderNumber(data.start_time)}${formattedAppointmentCount}`,
        //             payment_timing: data.payment_timing
        //         }),
        //     });
        // } else {

        //     await sendEmail({
        //         to: req.user.email,
        //         subject: appointmentBookingConfirmationTemplateSwedish.subject(data.payment_timing),
        //         html: appointmentBookingConfirmationTemplateSwedish.body({
        //             doctor_image: data.profile_image ? data.profile_image : `${APP_URL}/default_doctor_img.jpg`,
        //             doctor_name: `${appointments[0]?.name} ${appointments[0]?.last_name ? appointments[0]?.last_name : ""}`,
        //             clinic_name: data.clinic_name,
        //             visit_link: "#",
        //             refund_policy: "Denna bokade tid kan avbokas och återbetalas i sin helhet upp till 24 timmar före den schemalagda tiden.",
        //             subtotal: data.total_price ? `SEK ${data.total_price}` : "SEK 0.00",
        //             vat_amount: data.total_price ? `SEK ${(data.total_price - (data.total_price / 1.25))}` : "SEK 0.00",
        //             vat_percentage: (() => {
        //                 const total = parseFloat(data.total_price) || 0;
        //                 const vat = parseFloat(data.vat_amount) || 0;
        //                 const base = total - vat;

        //                 return base > 0 ? `${Math.round((vat / base) * 100)}` : "0";
        //             })(),

        //             treatments: data.treatments,
        //             start_time: formatDate(data.start_time),
        //             end_time: formatDate(data.end_time),
        //             order_number: `${generateOrderNumber(data.start_time)}${formattedAppointmentCount}`,
        //             payment_timing: data.payment_timing
        //         }),
        //     });
        // }


        return handleSuccess(
            res,
            201,
            language,
            'APPOINTMENT_BOOKED_SUCCESSFULLY',
            { appointment_id, chat_id, appointmentDetails: appointmentDetails }
        );
    }

    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
        }
        console.error("Error in saveOrBookAppointment:", err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const getDraftAppointments = asyncHandler(async (req, res) => {
    const { doctor_id } = req.params;
    const { user_id, language = "en" } = req.user;
    const draftData = await appointmentModel.getDraftAppointmentsModel(user_id, doctor_id);
    return handleSuccess(res, 200, language, "DRAFT_APPOINTMENTS_FETCHED_SUCCESSFULLY", draftData);
})

export const deleteDraftAppointment = asyncHandler(async (req, res) => {
    const { appointment_id, } = req.params;
    const { is_appointment } = req.query;
    const { user_id, language = "en" } = req.user;
    await appointmentModel.deleteDraftAppointmentsModel(user_id, appointment_id);
    return handleSuccess(res, 200, language, is_appointment ? "APPOINTMENT_DELETED_SUCCESSFULLY" : "DRAFT_APPOINTMENT_DELETED_SUCCESSFULLY",);
});

const formatDate = (date) => {
    const d = new Date(date);

    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();

    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");

    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12; // convert 0 → 12
    hours = String(hours).padStart(2, "0");

    //    ${hours}:${minutes} ${ampm}

    return `${day}-${month}-${year}`;
};


const generateOrderNumber = (start_time) => {
    return `#${new Date(start_time).getTime()}`;
};

const formatAppointmentCount = (count) => {
    const str = String(count);

    // If more than 3 digits → take first 3
    if (str.length > 3) {
        return str.slice(0, 3);
    }

    // If less than 3 digits → pad with leading zeros
    return str.padStart(3, "0");
};



export const sendReciept = async (req, res) => {
    try {

        const schema = Joi.object({
            appointment_id: Joi.string().required(),
        });


        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let {
            appointment_id
        } = value;


        const language = req?.user?.language || 'en';
        const userId = req.user.user_id;

        // ----------------- Fetch appointment -----------------
        const appointments = await appointmentModel.getAppointmentsById(userId, appointment_id, language);


        if (!appointments.length) {
            return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", null);
        }


        // ----------------- Map appointment data -----------------
        const result = await Promise.all(
            appointments.map(async (app) => {
                const doctor = await getDocterByDocterId(app.doctor_id);

                if (app.profile_image && !app.profile_image.startsWith("http")) {
                    app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
                }

                if (app.pdf && !app.pdf.startsWith("http")) {
                    app.pdf = `${APP_URL}${app.pdf}`;
                }

                const treatments = await appointmentModel.getAppointmentTreatments(appointment_id, language);

                return {
                    ...app,
                    treatments,
                };
            })
        );

        // ----------------- Send single appointment response -----------------
        // return handleSuccess(res, 200, language, "APPOINTMENTS_FETCHED", result[0]);
        const data = result[0];


        const [totalAppointmentBooked] = await appointmentModel.getNumberOfAppointments(userId);
        const formattedAppointmentCount = formatAppointmentCount(totalAppointmentBooked.count);

        if (language == "en") {

            await sendEmail({
                to: req.user.email,
                subject: appointmentReceiptTemplate.subject(),
                html: appointmentReceiptTemplate.body({
                    doctor_image: data.profile_image ? data.profile_image : `${APP_URL}/default_doctor_img.jpg`,
                    doctor_name: `${appointments[0]?.name} ${appointments[0]?.last_name ? appointments[0]?.last_name : ""}`,
                    clinic_name: data.clinic_name,
                    visit_link: "#",
                    refund_policy: "This appointment can be cancelled and will be fully refunded up to  24 hours before the schedule time.",
                    subtotal: `SEK ${(isNaN(Number(data?.total_price)) ? 0 : Number(data?.total_price)).toFixed(2)}`,
                    vat_amount: data.total_price ? `SEK ${(data.total_price - (data.total_price / 1.25))?.toFixed(2)}` : "SEK 0.00",
                    vat_percentage: (() => {
                        const total = parseFloat(data.total_price) || 0;
                        const vat = parseFloat(data.vat_amount) || 0;
                        const base = total - vat;

                        return base > 0 ? `${Math.round((vat / base) * 100)}` : "0";
                    })(),

                    treatments: data.treatments,
                    start_time: formatDate(data.start_time),
                    end_time: formatDate(data.end_time),
                    order_number: `${generateOrderNumber(data.start_time)}${formattedAppointmentCount}`,
                }),
            });
        } else {

            await sendEmail({
                to: req.user.email,
                subject: appointmentReceiptTemplateSwedish.subject(),
                html: appointmentReceiptTemplateSwedish.body({
                    doctor_image: data.profile_image ? data.profile_image : `${APP_URL}default_doctor_img.jpg`,
                    doctor_name: `${appointments[0]?.name} ${appointments[0]?.last_name ? appointments[0]?.last_name : ""}`,
                    clinic_name: data.clinic_name,
                    visit_link: "#",
                    refund_policy: "Denna bokade tid kan avbokas och återbetalas i sin helhet upp till 24 timmar före den schemalagda tiden.",
                    subtotal: data.total_price ? `SEK ${data.total_price}` : "SEK 0.00",
                    vat_amount: data.total_price ? `SEK ${(data.total_price - (data.total_price / 1.25))}` : "SEK 0.00",
                    vat_percentage: (() => {
                        const total = parseFloat(data.total_price) || 0;
                        const vat = parseFloat(data.vat_amount) || 0;
                        const base = total - vat;

                        return base > 0 ? `${Math.round((vat / base) * 100)}` : "0";
                    })(),

                    treatments: data.treatments,
                    start_time: formatDate(data.start_time),
                    end_time: formatDate(data.end_time),
                    order_number: `${generateOrderNumber(data.start_time)}${formattedAppointmentCount}`,
                }),
            });
        }


        return handleSuccess(
            res,
            200,
            language,
            'RECIEPT_SENT_SUCCESSFULLY',
        );
    }





    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return handleError(res, 400, "en", "SLOT_ALREADY_BOOKED");
        }
        console.error("Error in saveOrBookAppointment:", err);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};


export const handleStripeWebhook = async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = verifyStripeWebhook(req.body, sig);
    } catch (err) {
        return res.status(400).send(err.message);
    }

    try {
        switch (event.type) {
            case "checkout.session.completed":
                await handleCheckoutSessionCompleted(event.data.object);
                break;


            case "setup_intent.succeeded":
                await handleSetupIntentSucceeded(event.data.object);
                break;

            // case "setup_intent.succeeded": {
            //     const setupIntent = event.data.object;

            //     const appointment_id = setupIntent.metadata.appointment_id;
            //     const amount = setupIntent.metadata.amount_to_charge;
            //     const paymentMethod = setupIntent.payment_method;

            //     // Now charge immediately
            //     const paymentIntent = await stripe.paymentIntents.create({
            //         amount: amount * 100,
            //         currency: "sek",
            //         customer: setupIntent.customer,
            //         payment_method: paymentMethod,
            //         off_session: true,
            //         confirm: true,
            //         metadata: {
            //             appointment_id,
            //             payment_flow: "PAY_LATER_FINAL_CHARGE"
            //         }
            //     });

            //     await handleSetupIntentSucceeded(event.data.object);
            //     break;
            // }

            case "payment_intent.succeeded":
                await handlePaymentIntentSucceeded(event.data.object);
                break;

            case "payment_intent.payment_failed":
                await handlePaymentIntentFailed(event.data.object);
                break;


            default:
                console.log(`Unhandled event type ${event.type}`);
        }

        res.json({ received: true });
    } catch (err) {
        console.error("Error processing Stripe webhook:", err);
        res.status(500).send("Internal Server Error");
    }
};

export const sendAppointmentConfirmationNotifications = async (appointment_id,userId) => {
    try {
        const appointmentDetails = await getAppointmentDetails(userId, appointment_id);
        
        if (!appointmentDetails) {
            console.error(`Appointment ${appointment_id} not found`);
            return false;
        }

        const user_id = userId;
        const doctor_id = appointmentDetails.doctor_id;
        const start_time = appointmentDetails.start_time;
        const total_price = appointmentDetails.total_price;
        const normalizedStart = dayjs.utc(start_time).format("YYYY-MM-DD HH:mm:ss");

        // Get user and doctor details
        const [user] = await get_user_by_user_id(user_id);
        const doctor = await getDocterByDocterId(doctor_id);

        if (!user || !doctor || doctor.length === 0) {
            console.error(`User or doctor not found for appointment ${appointment_id}`);
            return false;
        }

        const language = user?.language || 'en';

        // Send notification to doctor
        await sendNotification({
            userData: { ...user, role: "USER" },
            type: "APPOINTMENT",
            type_id: appointment_id,
            notification_type: NOTIFICATION_MESSAGES.appointment_booked,
            receiver_id: doctor_id,
            receiver_type: "DOCTOR"
        });

        // Send email to doctor
        const selectedAppointmentBookedTemplate = language === "sv"
            ? appointmentBookedTemplateSv
            : appointmentBookedTemplate;
        await sendEmail({
            to: doctor[0].email,
            subject: selectedAppointmentBookedTemplate.subject({
                user_name: user?.full_name,
                appointment_date: normalizedStart
            }),
            html: selectedAppointmentBookedTemplate.body({
                user_name: user?.full_name,
                doctor_name: doctor[0].name,
                appointment_date: normalizedStart,
                total_price: total_price,
                clinic_name: appointmentDetails.clinic_name,
            }),
        });

        // Get appointment details for user email
        const appointments = await appointmentModel.getAppointmentsById(user_id, appointment_id, language);
        
        if (!appointments || appointments.length === 0) {
            console.error(`Appointment details not found for ${appointment_id}`);
            return false;
        }

        const result = await Promise.all(
            appointments.map(async (app) => {
                if (app.profile_image && !app.profile_image.startsWith("http")) {
                    app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
                }

                if (app.pdf && !app.pdf.startsWith("http")) {
                    app.pdf = `${APP_URL}${app.pdf}`;
                }

                const treatments = await appointmentModel.getAppointmentTreatments(appointment_id, language);

                return {
                    ...app,
                    treatments,
                };
            })
        );

        const data = result[0];

        // Get appointment count for order number
        const [totalAppointmentBooked] = await appointmentModel.getNumberOfAppointments(user_id);
        const formattedAppointmentCount = formatAppointmentCount(totalAppointmentBooked.count);

        // Email template data
        const emailData = {
            doctor_image: data.profile_image ? data.profile_image : `${APP_URL}/default_doctor_img.jpg`,
            doctor_name: `${appointments[0]?.name} ${appointments[0]?.last_name ? appointments[0]?.last_name : ""}`,
            clinic_name: data.clinic_name,
            visit_link: "#",
            subtotal: data.total_price ? `SEK ${data.total_price}` : "SEK 0.00",
            vat_amount: data.total_price ? `SEK ${(data.total_price - (data.total_price / 1.25)).toFixed(2)}` : "SEK 0.00",
            vat_percentage: (() => {
                const total = parseFloat(data.total_price) || 0;
                const vat = parseFloat(data.vat_amount) || 0;
                const base = total - vat;
                return base > 0 ? `${Math.round((vat / base) * 100)}` : "0";
            })(),
            treatments: data.treatments,
            start_time: formatDate(data.start_time),
            end_time: formatDate(data.end_time),
            order_number: `${generateOrderNumber(data.start_time)}${formattedAppointmentCount}`,
            payment_timing: data.payment_timing
        };

        // Send email to user based on language
        if (language === "en") {
            emailData.refund_policy = "This appointment can be cancelled and will be fully refunded up to 24 hours before the schedule time.";
            
            await sendEmail({
                to: user.email,
                subject: appointmentBookingConfirmationTemplate.subject(data.payment_timing),
                html: appointmentBookingConfirmationTemplate.body(emailData),
            });
        } else {
            emailData.refund_policy = "Denna bokade tid kan avbokas och återbetalas i sin helhet upp till 24 timmar före den schemalagda tiden.";
            
            await sendEmail({
                to: user.email,
                subject: appointmentBookingConfirmationTemplateSwedish.subject(data.payment_timing),
                html: appointmentBookingConfirmationTemplateSwedish.body(emailData),
            });
        }

        console.log(`✅ Notifications and emails sent for appointment ${appointment_id}`);
        return true;

    } catch (error) {
        console.error(`Error sending appointment notifications for ${appointment_id}:`, error);
        return false;
    }
};
