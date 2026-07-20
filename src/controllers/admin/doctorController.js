import { CompositionHookListInstance } from "twilio/lib/rest/video/v1/compositionHook.js";
import * as adminModels from "../../models/admin.js";
import { handleError, handleSuccess, joiErrorHandle } from "../../utils/responseHandler.js";
import { calculateProfileCompletionPercentageByDoctorId } from "../doctor/profileController.js";
import * as doctorModels from "../../models/doctor.js";
import * as clinicModels from "../../models/clinic.js";
import * as webModels from "../../models/web_user.js";
import dbOperations from '../../models/common.js';
import Joi from "joi";
import path from "path";
import { fileURLToPath } from 'url';
import { generatePassword, isEmpty } from "../../utils/user_helper.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import bcrypt from "bcrypt";
import ejs from 'ejs';
import dotenv from "dotenv";
import { sendEmail } from "../../services/send_email.js";
import { buildClinicData } from "../clinic/authController.js";
import { generateDoctorsEmbeddingsV2 } from "../api/embeddingsController.js";
import moment from 'moment/moment.js';
dotenv.config();


const APP_URL = process.env.APP_URL;
const image_logo = process.env.LOGO_URL_PNG;

export const get_doctors_management = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const search = req.query.search || "";
        const type = req.query.type || "";
        let zync_user_id = req.query.zync_user_id || null;
        const sortBy = req.query.sortBy || "created_at";
        const sortOrder = req.query.sortOrder || "DESC";

        // 1. Total doctor count
        const totalRecords = await adminModels.get_doctors_count(search, type);

        // 2. Fetch doctors with pagination
        const doctors = await adminModels.get_doctors_management(
            limit,
            offset,
            search,
            type,
            zync_user_id,
            sortBy,
            sortOrder
        );

        if (!doctors || doctors.length === 0) {
            return handleSuccess(res, 200, "en", "No doctors found", {
                Doctors: [],
                totalRecords,
                totalPages: 0,
                currentPage: page
            });
        }

        const fullDoctorData = await Promise.all(
            doctors.map(async (doctor) => {

                /* ---------------- PROFILE IMAGE ---------------- */
                doctor.profile_image =
                    doctor.profile_image
                        ? `${process.env.APP_URL}doctor/profile_images/${doctor.profile_image}`
                        : null;

                /* ---------------- BASIC DATA ---------------- */
                const experince = await adminModels.get_doctor_experience(doctor.doctor_id);
                const education = await adminModels.get_doctor_education(doctor.doctor_id);
                const treatments = await adminModels.get_doctor_treatments(doctor.doctor_id);
                const skinTypes = await adminModels.get_doctor_skin_types(doctor.doctor_id);
                const severityLevels = await adminModels.get_doctor_severity_levels(doctor.doctor_id);
                const surgeries = await adminModels.get_doctor_surgeries(doctor.doctor_id);
                const aestheticDevices = await adminModels.get_doctor_aesthetic_devices(doctor.doctor_id);
                let certifications = await doctorModels.get_doctor_certifications(doctor.doctor_id);

                if (certifications && Array.isArray(certifications)) {
                    certifications.forEach(certification => {
                        if (certification.upload_path && !certification.upload_path.startsWith("http")) {
                            certification.upload_path = `${APP_URL}doctor/certifications/${certification.upload_path}`;
                        }
                    });
                }
                /* ---------------- CLINICS (ARRAY) ---------------- */
                let clinics = await doctorModels.get_clinics_data_by_doctor_id(
                    doctor.doctor_id
                );

                clinics = Array.isArray(clinics) ? clinics : [];

                for (const clinic of clinics) {
                    delete clinic.embeddings;

                    clinic.clinic_logo = clinic.clinic_logo
                        ? `${process.env.APP_URL}clinic/logo/${clinic.clinic_logo}`
                        : null;

                    /* ================= CLINIC BASED DATA ================= */

                    clinic.treatments = await adminModels.getDoctorClinicTreatments(
                        doctor.doctor_id,
                        clinic.clinic_id
                    );

                    clinic.surgeries = await adminModels.getDoctorClinicSurgeries(
                        doctor.doctor_id,
                        clinic.clinic_id
                    );

                    clinic.skinTypes = await adminModels.getDoctorClinicSkinTypes(
                        doctor.doctor_id,
                        clinic.clinic_id
                    );

                    clinic.devices = await adminModels.getDoctorClinicDevices(
                        doctor.zynq_user_id,
                        clinic.clinic_id
                    );

                    clinic.slots = await doctorModels.getDoctorSlotSessionsModel(
                        doctor.doctor_id, clinic.clinic_id
                    );
                    // clinic.doctor_slot_time = clinic.slots[0]?.slot_time || null;

                    // clinic.doctorAvailabilities = await adminModels.getDoctorClinicAvailabilities(
                    //     doctor.doctor_id,
                    //     clinic.clinic_id
                    // );

                    const documents = await clinicModels.getClinicDocumentsLevel(
                        clinic.clinic_id
                    );
                    documents.forEach((document) => {
                        if (document.file_url && !document.file_url.startsWith("http")) {
                            document.file_url = `${APP_URL}${document.file_url}`;
                        }
                    });
                    clinic.documents = documents;

                    /* ---- SOLO DOCTOR → CLINIC IMAGES ---- */
                    if (doctor.user_type === "Solo Doctor") {
                        const images = await clinicModels.getClinicImages(clinic.clinic_id);

                        clinic.images = Array.isArray(images)
                            ? images
                                .filter(img => img?.image_url)
                                .map(img => ({
                                    clinic_image_id: img.clinic_image_id,
                                    url: img.image_url.startsWith("http")
                                        ? img.image_url
                                        : `${process.env.APP_URL}clinic/files/${img.image_url}`
                                }))
                            : [];
                    } else {
                        clinic.images = [];
                    }

                    /* ---- DOCTOR → CLINIC TIMING ---- */
                    if (doctor.user_type === "Doctor") {
                        clinic.clinicTiming =
                            await clinicModels.getClinicOperationHours(clinic.clinic_id);
                    } else {
                        clinic.clinicTiming =
                            await clinicModels.getClinicOperationHours(clinic.clinic_id);
                    }
                }

                const onboarding_progress =
                    await calculateProfileCompletionPercentageByDoctorId(doctor.doctor_id, doctor.user_type, clinics?.[0]?.clinic_id);

                /* ---------------- PROFILE STATUS FIX ---------------- */
                let profile_status = doctor.profile_status;
                if (onboarding_progress === 100 && profile_status !== "VERIFIED") {
                    profile_status = "ONBOARDING";
                }

                return {
                    ...doctor,
                    profile_status,
                    onboarding_progress,
                    experince,
                    education,
                    treatments,
                    skinTypes,
                    severityLevels,
                    surgeries,
                    aestheticDevices,
                    certifications,
                    clinics
                };
            })
        );

        return handleSuccess(res, 200, "en", "Fetch doctor management successfully", {
            Doctors: fullDoctorData,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limit),
            currentPage: page
        });

    } catch (error) {
        console.error("get_doctors_management error:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR " + error.message
        );
    }
};


export const sendDoctorOnaboardingInvitation = async (req, res) => {
    try {

        const schema = Joi.object({
            email: Joi.string().email().min(1).required(),
            clinic_id: Joi.array().items(Joi.string().uuid()).min(1).required(),
            name: Joi.string().max(255).optional().allow('', null),
            phone: Joi.string().max(255).optional().allow('', null),
            age: Joi.string().optional().allow('', null),
            address: Joi.string().max(255).optional().allow('', null),
            city: Joi.string().max(255).optional().allow('', null),
            zip_code: Joi.string().max(255).optional().allow('', null),
            // latitude: Joi.number().optional().allow('', null),
            // longitude: Joi.number().optional().allow('', null),
            latitude: Joi.number().optional().allow(null).empty('').default(null),
            longitude: Joi.number().optional().allow(null).empty('').default(null),
            gender: Joi.string().optional().allow('', null),
            biography: Joi.string().optional().allow(''),
            last_name: Joi.string().optional().allow('', null),

            fee_per_session: Joi.array().items(Joi.alternatives()
                .try(Joi.string(), Joi.number())
                .optional()
                .allow(null)).optional().allow(null),
            doctor_slot_time: Joi.array().items(Joi.alternatives()
                .try(Joi.string(), Joi.number())
                .optional()
                .allow(null,"")).optional().allow(null),

            education: Joi.array().items(Joi.object({
                institute: Joi.string().required(),
                degree: Joi.string().required(),
                start_year: Joi.string().required(),
                end_year: Joi.string().optional().allow(null)
            })).optional().allow(null),   // will be JSON

            experience: Joi.array().items(
                Joi.object({
                    organization: Joi.string().required(),
                    designation: Joi.string().required(),
                    start_date: Joi.string().required(),
                    end_date: Joi.string().optional().allow(null)
                })
            ).optional().allow(null),// will be JSON

            treatments: Joi.array().items(
                Joi.array().items(
                    Joi.object({
                        treatment_id: Joi.string().required(),
                        price: Joi.number().optional(),
                        sub_treatments: Joi.array().items(
                            Joi.object({
                                sub_treatment_id: Joi.string().required(),
                                sub_treatment_price: Joi.number().optional().allow(null, '')
                            })
                        ).optional()
                    })
                ).min(1).required()
            ).min(1).required(),


            skin_type_ids: Joi.array().items(
                Joi.array().items(
                    Joi.string().uuid().optional().allow(null)
                ).optional().allow(null)
            ).optional().allow(null),

            surgery_ids: Joi.array().items(
                Joi.array().items(
                    Joi.string().uuid().optional().allow(null)
                ).optional().allow(null)
            ).optional().allow(null),

            device_ids: Joi.array().items(
                Joi.array().items(
                    Joi.string().uuid().optional().allow(null)
                ).optional().allow(null)
            ).optional().allow(null),

            availability: Joi.array().items(
                Joi.array().items(
                    Joi.object({
                        day: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
                        slot_time: Joi.alternatives()
                            .try(Joi.string(), Joi.number())
                            .optional()
                            .allow("", null),
                        session: Joi.array().items(
                            Joi.object({
                                start_time: Joi.string().required(),
                                end_time: Joi.string().required(),
                            })).optional().allow(null),
                    })
                ).optional().allow(null)
            ).optional(),

            slot_time: Joi.string().optional().allow("", null),
        });

        if (typeof req.body.treatments === "string") {
            try {
                req.body.treatments = JSON.parse(req.body.treatments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_TREATMENTS");
            }
        }

        if (typeof req.body.fee_per_session === "string") {
            try {
                req.body.fee_per_session = JSON.parse(req.body.fee_per_session);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_FEEPERSESSION");
            }
        }
        if (typeof req.body.doctor_slot_time === "string") {
            try {
                req.body.doctor_slot_time = JSON.parse(req.body.doctor_slot_time);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_DOCTORSLOTTIME");
            }
        }


        if (typeof req.body.clinic_id === "string") {
            try {
                req.body.clinic_id = JSON.parse(req.body.clinic_id);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_CLICICID");
            }
        }

        if (typeof req.body.skin_type_ids === "string") {
            try {
                req.body.skin_type_ids = JSON.parse(req.body.skin_type_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKINTYPEID");
            }
        }

        if (typeof req.body.surgery_ids === "string") {
            try {
                req.body.surgery_ids = JSON.parse(req.body.surgery_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SURGERYID");
            }
        }

        if (typeof req.body.device_ids === "string") {
            try {
                req.body.device_ids = JSON.parse(req.body.device_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_DEVICEID");
            }
        }



        if (typeof req.body.availability === "string") {
            try {
                req.body.availability = JSON.parse(req.body.availability);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_AVAILABILITY");
            }
        }

        if (typeof req.body.education === "string") {
            try {
                req.body.education = JSON.parse(req.body.education);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EDUCATION");
            }
        }

        if (typeof req.body.experience === "string") {
            try {
                req.body.experience = JSON.parse(req.body.experience);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EXPERIENCE");
            }
        }

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { email,
            clinic_id,
            name,
            phone,
            age,
            address,
            city,
            zip_code,
            latitude,
            longitude,
            gender,
            biography,
            last_name,
            education,   // will be JSON
            experience, // will be JSON
            treatments,

            skin_type_ids,
            surgery_ids,
            device_ids, availability, slot_time, fee_per_session, doctor_slot_time } = value;

        console.log("req.body value", value)

        let language = req.user.language || "en";
        const emailTemplatePath = path.resolve(__dirname, "../../views/doctor_invite/en.ejs");

        const emailTemplatePath2 = path.resolve(__dirname, "../../views/doctor_invite/enn.ejs");

        if (treatments.length !== clinic_id.length) {
            return handleError(res, 400, language, "CLINIC_TREATMENT_MISMATCH");
        }

        const [existingUser] = await webModels.get_web_user_by_email(email);

        for (const item of clinic_id) {
            const [clinicData] = await clinicModels.getClinicProfile(item);
            if (!clinicData) {
                return handleError(res, 401, language, "CLINIC_NOT_FOUND");
            }
        }



        if (existingUser) {
            return handleError(
                res,
                400,
                language,
                "EMAIL_ALREADY"
            );
        }
        else {
            const roles = await clinicModels.getAllRoles();
            const doctorRole = roles.find(role => role.role === 'DOCTOR');
            if (!doctorRole) {
                return handleError(res, 400, language, "DOCTOR_ROLE_NOT_FOUND");
            }

            let password = generatePassword(email);
            const hashedPassword = await bcrypt.hash(password, 10);

            const insertdoctorData = {
                email,
                password: hashedPassword,
                show_password: password,
                role_id: doctorRole.id,
                created_at: new Date(),
            };

            await webModels.create_web_user(insertdoctorData);
            let [newWebUser] = await webModels.get_web_user_by_email(email);


            const zynqUserId = newWebUser.id;

            const doctorTableData = {
                zynq_user_id: newWebUser.id,
                created_at: new Date(),
                slot_time: slot_time || null,
                profile_status: "IMPORTED",
                address: address || null,
                city: city || null,
                zip_code: zip_code || null
            };
            await clinicModels.create_doctor(doctorTableData);
            const [createdDoctor] = await clinicModels.get_doctor_by_zynq_user_id(newWebUser.id);
            let doctor = createdDoctor;
            let doctor_id = doctor.doctor_id;


            let filename = '';
            if (req.files?.profile?.length > 0) {
                filename = req.files.profile[0].filename
            }


            const result = await doctorModels.add_personal_details(zynqUserId, name, phone, age, address, city, zip_code, latitude, longitude, gender, filename, biography, last_name, slot_time, createdDoctor.profile_status);

            const files = req.files;
            if (Object.keys(files).length > 0) { // Only process if new files are actually uploaded
                for (const key in files) { // 'key' is like 'medical_council', 'deramatology_board', etc.
                    const certTypeFromDb = await doctorModels.get_certification_type_by_filename(key);

                    if (certTypeFromDb.length > 0) {
                        const certification_type_id = certTypeFromDb[0].certification_type_id;

                        for (const file of files[key]) { // Loop through potential multiple files for the same field name
                            const newUploadPath = file.filename; // This is the new path

                            // Check if this certification type already exists for the doctor
                            const existingCert = await doctorModels.get_doctor_certification_by_type(doctor_id, certification_type_id);

                            if (existingCert.length > 0) {
                                // Certification already exists, update its file path
                                await doctorModels.update_certification_upload_path(doctor_id, certification_type_id, newUploadPath);

                            } else {
                                // Certification does not exist, add it
                                await doctorModels.add_certification(doctor_id, certification_type_id, newUploadPath); // Add other metadata if available from req.body

                            }
                        }
                    } else {
                        console.warn(`Certification type with filename key '${key}' not found in tbl_certification_type. Skipping file processing.`);
                    }
                }
            }


            const eduArray = Array.isArray(education) ? education : [];
            const expArray = Array.isArray(experience) ? experience : [];

            if (eduArray.length > 0) {
                await doctorModels.delete_all_education(doctor_id);
                console.log("eduArray", eduArray);
                for (let edu of eduArray) {
                    await doctorModels.add_education(doctor_id, edu.institute, edu.degree, edu.start_year, edu.end_year);
                }
            }

            if (expArray.length > 0) {
                await doctorModels.delete_all_experience(doctor_id);
                for (let exp of expArray) {
                    await doctorModels.add_experience(doctor_id, exp.organization, exp.designation, exp.start_date, exp.end_date);
                }
            }

            await Promise.all(
                clinic_id.map(async (item, index) => {
                    const clinicMapData = {
                        doctor_id,
                        clinic_id: item,
                        assigned_at: new Date(),
                        fee_per_session: fee_per_session[index] || null,
                        doctor_slot_time: doctor_slot_time[index] || null,
                    };
                    await clinicModels.create_doctor_clinic_map(clinicMapData);


                    const [doctorClinicMap] = await clinicModels.get_doctor_clinic_map_by_both(doctor_id, item);
                    const invitation_id = doctorClinicMap?.map_id;

                    let sendPassword = password;
                    if (!password && existingUser) {
                        sendPassword = existingUser.show_password;
                    };


                    const [clinicData] = await clinicModels.getClinicProfile(item);

                    const [get_location] = await clinicModels.get_clinic_location_by_clinic_id(item);

                    const emailHtml = await ejs.renderFile(language == "en" ? emailTemplatePath : emailTemplatePath2, {
                        clinic_name: clinicData?.clinic_name || "#N/A",
                        clinic_org_number: clinicData?.org_number || "#N/A",
                        clinic_city: get_location?.city || "#N/A",
                        clinic_street_address: get_location?.street_address || "#N/A",
                        clinic_state: get_location?.state || "#N/A",
                        clinic_zip: get_location?.zip_code || "#N/A",
                        clinic_phone: clinicData?.mobile_number || "#N/A",
                        clinic_email: clinicData?.email,
                        email,
                        password: sendPassword,
                        image_logo,
                        invitation_id,
                        invitation_link: `${APP_URL}clinic/accept-invitation?invitation_id=${invitation_id}`,
                    });

                    const emailOptions = {
                        to: email,
                        subject: "Professional Invitation",
                        html: emailHtml,
                    };
                    // await sendEmail(emailOptions);


                    const availabilityArray = availability ? availability[index] : [];
                    console.log("availabilityArray=>", availabilityArray)

                    if (Array.isArray(availabilityArray) && availabilityArray.length > 0) {
                        const data = await doctorModels.updateDoctorSessionSlots(doctor_id, availabilityArray, item);
                        console.log("data=>", data);
                    }


                    // Convert CSV strings into arrays
                    const skinTypeIds = skin_type_ids ? skin_type_ids[index] : [];
                    const surgeryIds = surgery_ids ? surgery_ids[index] : [];
                    const deviceIds = device_ids ? device_ids[index] : [];
                    const clinicTreatments = treatments?.[index] || [];

                    // Save expertis
                    if (Array.isArray(clinicTreatments) && clinicTreatments.length > 0) {
                        await doctorModels.update_doctor_treatments(doctor_id, clinicTreatments, item);
                    }
                    if (Array.isArray(skinTypeIds) && skinTypeIds.length > 0) {
                        console.log("skinTypeIds inserted");
                        await doctorModels.update_doctor_skin_types(doctor_id, skinTypeIds, item);
                    }
                    if (Array.isArray(surgeryIds) && surgeryIds.length > 0) {
                        console.log("surgeryIds inserted");
                        await doctorModels.update_doctor_surgery(doctor_id, surgeryIds, item);
                    }
                    if (Array.isArray(deviceIds) && deviceIds.length > 0) {
                        console.log("deviceIds inserted");
                        await doctorModels.update_doctor_treatment_devices(
                            zynqUserId,       // zynq_user_id
                            clinicTreatments, // treatments array
                            deviceIds,       // device ids
                            item
                        );
                    }
                }))

            return handleSuccess(res, 200, language, "EXPERT_ADDED_SUCCESSFULLY");

        }
    } catch (error) {
        console.error("Error sending doctor invitation:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};


export const mapTreatmentsForClinic = (treatments = []) => {
    return treatments.map(treatment => ({
        treatment_id: treatment.treatment_id,
        total_price: Number(treatment.price) || 0,

        sub_treatments: Array.isArray(treatment.sub_treatments)
            ? treatment.sub_treatments.map(sub => ({
                sub_treatment_id: sub.sub_treatment_id,
                price: Number(sub.sub_treatment_price)
            }))
            : null
    }));
};

export const mapAvailabilityToClinicTiming = (availability = []) => {
    if (!Array.isArray(availability) || availability.length === 0) {
        return null;
    }

    const clinicTiming = {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
    };

    availability.forEach(item => {
        const dayKey = item.day_of_week.toLowerCase();

        clinicTiming[dayKey] = {
            open: item.closed === 1 ? "" : item.start_time,
            close: item.closed === 1 ? "" : item.end_time,
            is_closed: item.closed === 1
        };
    });

    return clinicTiming;
};

export const convertAvailability = (flatAvailability, slotMinutes = 15) => {
    const result = [];

    // Group by day
    const grouped = flatAvailability.reduce((acc, item) => {
        if (!acc[item.day_of_week]) acc[item.day_of_week] = [];
        acc[item.day_of_week].push(item);
        return acc;
    }, {});

    for (const day in grouped) {
        const sessions = [];

        for (const slot of grouped[day]) {
            if (slot.closed) continue; // skip closed slots

            if (!slot.start_time || !slot.end_time) continue; // skip empty times

            let start = slot.start_time.split(':').map(Number);
            let end = slot.end_time.split(':').map(Number);

            let startMinutes = start[0] * 60 + start[1];
            let endMinutes = end[0] * 60 + end[1];

            while (startMinutes + slotMinutes <= endMinutes) {
                const sH = String(Math.floor(startMinutes / 60)).padStart(2, '0');
                const sM = String(startMinutes % 60).padStart(2, '0');
                const eH = String(Math.floor((startMinutes + slotMinutes) / 60)).padStart(2, '0');
                const eM = String((startMinutes + slotMinutes) % 60).padStart(2, '0');

                sessions.push({ start_time: `${sH}:${sM}:00`, end_time: `${eH}:${eM}:00` });

                startMinutes += slotMinutes;
            }
        }

        result.push({ day, session: sessions, slot_time: slotMinutes });
    }

    return result;
}


export const sendSoloDoctorOnaboardingInvitation = async (req, res) => {
    try {

        const schema = Joi.object({
            email: Joi.string().email().min(1).required(),
            slot_time: Joi.string().required(),
            same_for_all: Joi.string().valid("1", "0").optional().allow(null),
            name: Joi.string().max(255).optional().allow('', null),
            last_name: Joi.string().max(255).optional().allow('', null),
            age: Joi.string().optional().allow('', null),
            gender: Joi.string().optional().allow('', null),
            clinic_name: Joi.string().optional().allow('', null),
            clinic_description: Joi.string().optional().allow('', null),
            org_number: Joi.string().optional().allow('', null),
            street_address: Joi.string().optional().allow('', null),
            city: Joi.string().optional().allow('', null),
            state: Joi.string().optional().allow('', null),
            zip_code: Joi.string().optional().allow('', null),
            latitude: Joi.string().optional().allow('', null),
            longitude: Joi.string().optional().allow('', null),
            mobile_number: Joi.string().optional().allow('', null),
            website_url: Joi.string().optional().allow('', null),
            address: Joi.string().optional().allow('', null),
            is_onboarded: Joi.number().integer().optional(),
            ivo_registration_number: Joi.string().optional().allow('', null),
            hsa_id: Joi.string().optional().allow('', null),
            form_stage: Joi.string().optional().allow('', null),
            education: Joi.array().items(Joi.object({
                institute: Joi.string().required(),
                degree: Joi.string().required(),
                start_year: Joi.string().required(),
                end_year: Joi.string().optional().allow(null)
            })).optional().allow(null),   // will be JSON
            experience: Joi.array().items(
                Joi.object({
                    organization: Joi.string().required(),
                    designation: Joi.string().required(),
                    start_date: Joi.string().required(),
                    end_date: Joi.string().optional().allow(null)
                })
            ).optional().allow(null),
            fee_per_session: Joi.string().optional().allow(null),
            currency: Joi.string().min(1).max(10).default('USD').optional(),
            session_duration: Joi.string().optional(),
            fee_range: Joi.string().optional().allow('', null),
            availability: Joi.array().items(
                Joi.object({
                    day_of_week: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
                    start_time: Joi.string().required().allow(''),
                    end_time: Joi.string().required().allow(''),
                    closed: Joi.number().integer().required()
                })
            ).optional(),
            treatments: Joi.array().items(
                Joi.object({
                    treatment_id: Joi.string().required(),
                    price: Joi.number().optional(),
                    sub_treatments: Joi.array().items(
                        Joi.object({
                            sub_treatment_id: Joi.string().required(),
                            sub_treatment_price: Joi.number().optional().allow(null, '')
                        })
                    ).optional()
                })
            ).optional(),

            skin_type_ids: Joi.array().items(Joi.string().uuid()).optional().allow(null),
            surgery_ids: Joi.array().items(Joi.string().uuid()).optional().allow(null),
            device_ids: Joi.array().items(Joi.string().uuid()).optional().allow(null)
        });

        if (typeof req.body.treatments === "string") {
            try {
                req.body.treatments = JSON.parse(req.body.treatments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_TREATMENTS");
            }
        }

        if (typeof req.body.skin_type_ids === "string") {
            try {
                req.body.skin_type_ids = JSON.parse(req.body.skin_type_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKINTYPEID");
            }
        }

        if (typeof req.body.surgery_ids === "string") {
            try {
                req.body.surgery_ids = JSON.parse(req.body.surgery_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SURGERYID");
            }
        }

        if (typeof req.body.device_ids === "string") {
            try {
                req.body.device_ids = JSON.parse(req.body.device_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_DEVICEID");
            }
        }

        if (typeof req.body.education === "string") {
            try {
                req.body.education = JSON.parse(req.body.education);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EDUCATION");
            }
        }

        if (typeof req.body.experience === "string") {
            try {
                req.body.experience = JSON.parse(req.body.experience);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EXPERIENCE");
            }
        }

        if (typeof req.body.availability === "string") {
            try {
                req.body.availability = JSON.parse(req.body.availability);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_AVAILABILITY");
            }
        }

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const {
            email,
            name,
            last_name,
            age,
            gender,
            clinic_name,
            clinic_description,
            org_number,
            street_address,
            city,
            state,
            zip_code,
            latitude,
            longitude,
            mobile_number,
            website_url,
            address,
            education,
            experience,
            treatments,
            fee_per_session,
            currency,
            session_duration,
            availability,
            skin_type_ids,
            surgery_ids,
            device_ids,
            is_onboarded,
            ivo_registration_number,
            hsa_id,
            fee_range,
            form_stage,
            slot_time,
            same_for_all
        } = value;


        let language = req.user.language || "en";

        const existingUser = await adminModels.findClinicEmail(email);
        if (existingUser?.length > 0) {
            return handleError(res, 409, 'en', "Email already exists", {
                email: email
            });
        }

        const findRole = await adminModels.findRole('SOLO_DOCTOR');
        if (!findRole) return handleError(res, 404, 'en', "Role 'SOLO_DOCTOR' not found");

        const roleId = findRole.id;
        const password = await generatePassword(email);
        const hashedPassword = await bcrypt.hash(password, 10);

        await adminModels.addZynqUsers({ email, role_id: roleId, password: hashedPassword, show_password: password });

        const [newUser] = await adminModels.findClinicEmail(email);

        let zynq_user_id = newUser.id;

        language = language || "en";

        const clinic_logo = req?.files?.logo ? req?.files?.logo[0]?.filename : null

        const clinicData = {
            zynq_user_id:
                zynq_user_id === "" ? null : zynq_user_id,
            clinic_name:
                clinic_name === "" ? null : clinic_name,
            org_number:
                org_number === "" ? null : org_number,
            email: email === "" ? null : email,
            // email: email === "" ? null : email || clinic_data.email,
            mobile_number:
                mobile_number === ""
                    ? null
                    : mobile_number,
            address: address === "" ? null : address,
            fee_range: fee_range === "" ? null : fee_range,
            website_url: website_url === "" ? null : website_url,
            clinic_description: clinic_description === "" ? null : clinic_description,
            language: language === "" ? null : language,
            clinic_logo: clinic_logo === "" ? null : clinic_logo,
            form_stage: form_stage === "" ? null : form_stage,
            ivo_registration_number: ivo_registration_number === "" ? null : ivo_registration_number,
            hsa_id: hsa_id === "" ? null : hsa_id,
            is_onboarded: 0,
            city: city === "" ? null : city,
            state: state === "" ? null : state,
            same_for_all: same_for_all ? same_for_all : 0
        };

        delete clinicData.city;
        delete clinicData.state;

        let profile_status = "IMPORTED";

        const clinicDataV2 = buildClinicData(clinicData);

        delete clinicDataV2.city;
        delete clinicDataV2.state;

        clinicDataV2.slot_time = slot_time

        await clinicModels.insertClinicData(clinicDataV2);


        const [clinic] = await dbOperations.getSelectedColumn(
            "clinic_id",
            "tbl_clinics",
            `WHERE zynq_user_id='${zynq_user_id}'`
        );

        const clinic_id = clinic?.clinic_id;


        const [clinicLocation] = await clinicModels.getClinicLocation(clinic_id);
        if (clinicLocation) {
            const update_data = {
                clinic_id: clinic_id,
                street_address:
                    street_address === ""
                        ? null
                        : street_address || clinicLocation.street_address,
                city: city === "" ? null : city || clinicLocation.city,
                state: state === "" ? null : state || clinicLocation.state,
                zip_code: zip_code === "" ? null : zip_code || clinicLocation.zip_code,
                latitude: latitude || clinicLocation.latitude,
                longitude: longitude || clinicLocation.longitude,
            };

            await clinicModels.updateClinicLocation(update_data, clinic_id);
        } else {
            const insert_data = {
                clinic_id: clinic_id,
                street_address: street_address,
                city: city,
                state: state,
                zip_code: zip_code,
                latitude: latitude,
                longitude: longitude,
            };
            await clinicModels.insertClinicLocation(insert_data);
        }



        await dbOperations.insertData("tbl_doctors", {
            zynq_user_id: zynq_user_id,
            name,
            last_name,
            gender: gender,
            age: age,
            biography: clinic_description,
            profile_image: req?.files?.profile ? req?.files?.profile[0]?.filename : null,
            phone: mobile_number,
            address: address,
            fee_per_session: fee_per_session ?? null,
            currency: currency,
            session_duration: session_duration,
            slot_time: slot_time || null,
            profile_status: "IMPORTED"
        });


        const [doctor] = await dbOperations.getSelectedColumn(
            "doctor_id",
            "tbl_doctors",
            `WHERE zynq_user_id='${zynq_user_id}'`
        );

        const doctorId = doctor.doctor_id;



        if (doctor && clinic) {
            await dbOperations.insertData("tbl_doctor_clinic_map", {
                doctor_id: doctorId,
                clinic_id: clinic_id,
            });
        }

        const uploadedFiles = req.files || {};
        const clinicImageFiles = [];

        if (Array.isArray(uploadedFiles.files) && uploadedFiles.files.length > 0) {
            for (const file of uploadedFiles.files) {
                const fileName = file.filename;
                clinicImageFiles.push(fileName);
            }

            if (clinicImageFiles.length > 0) {
                await clinicModels.insertClinicImages(clinic_id, clinicImageFiles);
            }
        }



        const files = req.files;
        if (Object.keys(files).length > 0) { // Only process if new files are actually uploaded
            for (const key in files) { // 'key' is like 'medical_council', 'deramatology_board', etc.
                const certTypeFromDb = await doctorModels.get_certification_type_by_filename(key);

                if (certTypeFromDb.length > 0) {
                    const certification_type_id = certTypeFromDb[0].certification_type_id;

                    for (const file of files[key]) { // Loop through potential multiple files for the same field name
                        const newUploadPath = file.filename; // This is the new path

                        // Check if this certification type already exists for the doctor
                        const existingCert = await doctorModels.get_doctor_certification_by_type(doctorId, certification_type_id);

                        if (existingCert.length > 0) {
                            // Certification already exists, update its file path
                            await doctorModels.update_certification_upload_path(doctorId, certification_type_id, newUploadPath);

                        } else {
                            // Certification does not exist, add it
                            await doctorModels.add_certification(doctorId, certification_type_id, newUploadPath); // Add other metadata if available from req.body

                        }
                    }
                } else {
                    console.warn(`Certification type with filename key '${key}' not found in tbl_certification_type. Skipping file processing.`);
                }
            }
        }

        const eduArray = Array.isArray(education) ? education : [];
        const expArray = Array.isArray(experience) ? experience : [];

        if (eduArray.length > 0) {
            await doctorModels.delete_all_education(doctorId);
            for (let edu of eduArray) {
                await doctorModels.add_education(doctorId, edu.institute, edu.degree, edu.start_year, edu.end_year);
            }
        }

        if (expArray.length > 0) {
            await doctorModels.delete_all_experience(doctorId);
            for (let exp of expArray) {
                await doctorModels.add_experience(doctorId, exp.organization, exp.designation, exp.start_date, exp.end_date);
            }
        }

        if (availability?.length > 0) {
            const doctorSession = convertAvailability(availability, Number(slot_time));
            await doctorModels.updateDoctorSessionSlots(doctorId, doctorSession, clinic_id);
            const clinic_timing = mapAvailabilityToClinicTiming(availability);
            await clinicModels.updateClinicOperationHours(clinic_timing, clinic_id);
        }

        // Convert CSV strings into arrays
        const skinTypeIds = skin_type_ids ? skin_type_ids : [];
        const surgeryIds = surgery_ids ? surgery_ids : [];
        const deviceIds = device_ids ? device_ids : [];

        // Save expertis
        if (Array.isArray(treatments) && treatments.length > 0) {
            const mappedTreatments = mapTreatmentsForClinic(treatments);

            const treatmentsData =
                await clinicModels.createClinicMappedTreatments(
                    clinic_id,
                    mappedTreatments
                );

            await doctorModels.update_doctor_treatments(doctorId, treatments);
        }

        if (skinTypeIds.length > 0) {
            await doctorModels.update_doctor_skin_types(doctorId, skinTypeIds, clinic_id);
            await clinicModels.updateClinicSkinTypes(skinTypeIds, clinic_id);
        }
        if (surgeryIds.length > 0) {
            await doctorModels.update_doctor_surgery(doctorId, surgeryIds, clinic_id);
            await clinicModels.updateClinicSurgeries(surgeryIds, clinic_id);
        }

        // NEW: Save treatment → user → device mapping
        if (deviceIds.length > 0 && Array.isArray(treatments)) {
            await doctorModels.update_doctor_treatment_devices(
                zynq_user_id,       // zynq_user_id
                treatments, // treatments array
                deviceIds,         // device ids
                clinic_id
            );
            await clinicModels.updateClinicAestheticDevices(
                deviceIds,
                clinic_id
            );
        };


        const updatedEmailCount = 1;

        await adminModels.updateClinicCountAndEmailSent(
            clinic_id,
            updatedEmailCount,
            moment().format('YYYY-MM-DD HH:mm:ss')
        );
        const is_subscribed = clinic_id;

        const html = await ejs.renderFile(
            path.join(__dirname, "../../views/invitation-mail.ejs"),
            {
                clinic_name: clinic_name || "#N/A",
                organization_number: org_number || "#N/A",
                email: email,
                phone: mobile_number || "#N/A",
                city: city || "#N/A",
                postal_code: zip_code || "#N/A",
                address: address || "#N/A",
                password: password,
                logo: image_logo,
                invitationLink: `${APP_URL}admin/subscribed/${is_subscribed}`,
            }
        );

        // await sendEmail({
        //     to: email,
        //     subject: "You're One Step Away from Joining ZYNQ – Accept Your Invite",
        //     html,
        // });



        return handleSuccess(res, 200, language, "SOLO_EXPERT_UPDATED_SUCCESSFULLY");

    } catch (error) {
        console.error("Error sending doctor invitation:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const updateDoctorController = async (req, res) => {
    try {

        const schema = Joi.object({
            clinic_id: Joi.array().items(Joi.string().uuid()).min(1).required(),
            zynq_user_id: Joi.string().uuid().required(),
            name: Joi.string().max(255).optional().allow('', null),
            phone: Joi.string().max(255).optional().allow('', null),
            age: Joi.string().optional().allow('', null),
            address: Joi.string().max(255).optional().allow('', null),
            gender: Joi.string().optional().allow('', null),
            biography: Joi.string().optional().allow(''),
            last_name: Joi.string().optional().allow('', null),
            city: Joi.string().max(255).optional().allow('', null),
            zip_code: Joi.string().max(255).optional().allow('', null),
            latitude: Joi.number().optional().allow(null).empty('').default(null),
            longitude: Joi.number().optional().allow(null).empty('').default(null),
            fee_per_session: Joi.array().items(Joi.alternatives()
                .try(Joi.string(), Joi.number())
                .optional()
                .allow(null)).optional().allow(null),
            doctor_slot_time: Joi.array().items(Joi.alternatives()
                .try(Joi.string(), Joi.number())
                .optional()
                .allow(null)).optional().allow(null),
            education: Joi.array().items(Joi.object({
                institute: Joi.string().required(),
                degree: Joi.string().required(),
                start_year: Joi.string().required(),
                end_year: Joi.string().optional().allow(null)
            })).optional().allow(null),   // will be JSON
            experience: Joi.array().items(
                Joi.object({
                    organization: Joi.string().required(),
                    designation: Joi.string().required(),
                    start_date: Joi.string().required(),
                    end_date: Joi.string().optional().allow(null)
                })
            ).optional().allow(null),// will be JSON


            treatments: Joi.array().items(
                Joi.array().items(
                    Joi.object({
                        treatment_id: Joi.string().required(),
                        price: Joi.number().optional(),
                        sub_treatments: Joi.array().items(
                            Joi.object({
                                sub_treatment_id: Joi.string().required(),
                                sub_treatment_price: Joi.number().optional().allow(null, '')
                            })
                        ).optional()
                    })
                ).min(1).required()
            ).min(1).required(),


            skin_type_ids: Joi.array().items(
                Joi.array().items(
                    Joi.string().uuid().optional().allow(null)
                ).optional().allow(null)
            ).optional().allow(null),

            surgery_ids: Joi.array().items(
                Joi.array().items(
                    Joi.string().uuid().optional().allow(null)
                ).optional().allow(null)
            ).optional().allow(null),

            device_ids: Joi.array().items(
                Joi.array().items(
                    Joi.string().uuid().optional().allow(null)
                ).optional().allow(null)
            ).optional().allow(null),

            availability: Joi.array().items(
                Joi.array().items(
                    Joi.object({
                        day: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
                        slot_time: Joi.alternatives()
                            .try(Joi.string(), Joi.number())
                            .optional()
                            .allow("", null),
                        session: Joi.array().items(
                            Joi.object({
                                start_time: Joi.string().required(),
                                end_time: Joi.string().required(),
                            })).optional().allow(null),
                    })
                ).optional().allow(null)
            ).optional(),


            slot_time: Joi.string().optional().allow("", null),
        });

        if (typeof req.body.fee_per_session === "string") {
            try {
                req.body.fee_per_session = JSON.parse(req.body.fee_per_session);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_FEEPERSESSION");
            }
        }
        if (typeof req.body.doctor_slot_time === "string") {
            try {
                req.body.doctor_slot_time = JSON.parse(req.body.doctor_slot_time);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_DOCTORSLOTTIME");
            }
        }

        if (typeof req.body.clinic_id === "string") {
            try {
                req.body.clinic_id = JSON.parse(req.body.clinic_id);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_CLICICID");
            }
        }

        if (typeof req.body.treatments === "string") {
            try {
                req.body.treatments = JSON.parse(req.body.treatments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_TREATMENTS");
            }
        }

        if (typeof req.body.availability === "string") {
            try {
                req.body.availability = JSON.parse(req.body.availability);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_AVAILABILITY");
            }
        }

        if (typeof req.body.education === "string") {
            try {
                req.body.education = JSON.parse(req.body.education);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EDUCATION");
            }
        }

        if (typeof req.body.experience === "string") {
            try {
                req.body.experience = JSON.parse(req.body.experience);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EXPERIENCE");
            }
        }

        if (typeof req.body.skin_type_ids === "string") {
            try {
                req.body.skin_type_ids = JSON.parse(req.body.skin_type_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKINTYPEID");
            }
        }

        if (typeof req.body.surgery_ids === "string") {
            try {
                req.body.surgery_ids = JSON.parse(req.body.surgery_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SURGERYID");
            }
        }

        if (typeof req.body.device_ids === "string") {
            try {
                req.body.device_ids = JSON.parse(req.body.device_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_DEVICEID");
            }
        }

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const {
            clinic_id,
            zynq_user_id,
            name,
            phone,
            age,
            address,
            gender,
            biography,
            last_name,
            education,   // will be JSON
            experience, // will be JSON
            treatments,
            skin_type_ids,
            surgery_ids,
            device_ids,
            availability,
            slot_time,
            longitude,
            latitude,
            city,
            zip_code,
            fee_per_session,
            doctor_slot_time
        } = value;

        let language = req.user.language || "en";

        const [doctorData] = await doctorModels.get_doctor_by_zynquser_id(zynq_user_id);

        if (!doctorData) {
            return handleError(res, 404, language, "DOCTOR_NOT_FOUND");
        }
        let doctorId = doctorData.doctor_id;
        let filename = doctorData.profile_image;
        if (req.files?.profile?.length > 0) {
            filename = req.files.profile[0].filename
        }
        // await generateDoctorsEmbeddingsV2(doctorData.doctor_id)
        const result = await doctorModels.add_personal_details(zynq_user_id, name ? name : doctorData?.name, phone ? phone : doctorData?.phone, age ? age : doctorData?.age, address ? address : doctorData?.address, city ? city : doctorData?.city, zip_code ? zip_code : doctorData?.zip_code, latitude ? latitude : doctorData?.latitude, longitude ? longitude : doctorData?.longitude, gender ? gender : doctorData?.gender, filename, biography ? biography : doctorData?.biography, last_name ? last_name : doctorData.last_name, slot_time ? slot_time : doctorData?.slot_time, doctorData.profile_status);

        const files = req.files || {};
        if (Object.keys(files).length > 0) { // Only process if new files are actually uploaded
            for (const key in files) { // 'key' is like 'medical_council', 'deramatology_board', etc.
                const certTypeFromDb = await doctorModels.get_certification_type_by_filename(key);

                if (certTypeFromDb.length > 0) {
                    const certification_type_id = certTypeFromDb[0].certification_type_id;

                    for (const file of files[key]) { // Loop through potential multiple files for the same field name
                        const newUploadPath = file.filename; // This is the new path

                        // Check if this certification type already exists for the doctor
                        const existingCert = await doctorModels.get_doctor_certification_by_type(doctorId, certification_type_id);

                        if (existingCert.length > 0) {
                            // Certification already exists, update its file path
                            await doctorModels.update_certification_upload_path(doctorId, certification_type_id, newUploadPath);

                        } else {
                            // Certification does not exist, add it
                            await doctorModels.add_certification(doctorId, certification_type_id, newUploadPath); // Add other metadata if available from req.body

                        }
                    }
                } else {
                    console.warn(`Certification type with filename key '${key}' not found in tbl_certification_type. Skipping file processing.`);
                }
            }
        }

        const eduArray = Array.isArray(education) ? education : [];
        const expArray = Array.isArray(experience) ? experience : [];


        if (eduArray.length > 0) {
            await doctorModels.delete_all_education(doctorId);
            for (let edu of eduArray) {
                await doctorModels.add_education(doctorId, edu.institute, edu.degree, edu.start_year, edu.end_year);
            }
        }

        if (expArray.length > 0) {
            await doctorModels.delete_all_experience(doctorId);
            for (let exp of expArray) {
                await doctorModels.add_experience(doctorId, exp.organization, exp.designation, exp.start_date, exp.end_date);
            }
        };


        let [user] = await webModels.get_web_user_by_id(zynq_user_id);

        await Promise.all(
            clinic_id.map(async (item, index) => {

                const [existingMap] = await clinicModels.get_doctor_clinic_map_by_both(
                    doctorId,
                    item
                );

                if (!existingMap) {
                    const clinicMapData = {
                        doctor_id: doctorId,
                        clinic_id: item,
                        assigned_at: new Date(),
                    };
                    await clinicModels.create_doctor_clinic_map(clinicMapData);
                    const [doctorClinicMap] = await clinicModels.get_doctor_clinic_map_by_both(doctorId, item);
                    const invitation_id = doctorClinicMap?.map_id;

                    const [clinicData] = await clinicModels.getClinicProfile(item);

                    const [get_location] = await clinicModels.get_clinic_location_by_clinic_id(item);


                    const emailTemplatePath = path.resolve(__dirname, "../../views/doctor_invite/en.ejs");

                    const emailTemplatePath2 = path.resolve(__dirname, "../../views/doctor_invite/enn.ejs");

                    // Send invitation WITHOUT password → use enn.ejs
                    const emailHtml = await ejs.renderFile(emailTemplatePath2,
                        {
                            clinic_name: clinicData?.clinic_name || "#N/A",
                            clinic_org_number: clinicData?.org_number || "#N/A",
                            clinic_city: get_location?.city || "#N/A",
                            clinic_street_address: get_location?.street_address || "#N/A",
                            clinic_state: get_location?.state || "#N/A",
                            clinic_zip: get_location?.zip_code || "#N/A",
                            clinic_phone: clinicData?.mobile_number || "#N/A",
                            clinic_email: clinicData?.email || "#N/A",
                            image_logo,
                            invitation_id,
                            invitation_link: `${APP_URL}clinic/accept-invitation?invitation_id=${invitation_id}`,
                        }
                    );

                    await sendEmail({
                        to: user.email,
                        subject: "Professional Invitation",
                        html: emailHtml,
                    });
                }

                const availabilityArray = availability ? availability[index] : [];
                console.log("availabilityArray=>", availabilityArray)


                if (Array.isArray(doctor_slot_time) && doctor_slot_time.length > 0 || Array.isArray(fee_per_session) && fee_per_session.length > 0) {
                    const data = await doctorModels.updateDoctorSlotTimeAndCunsultationFeeOfClinicModel({ doctor_id: doctorId, clinic_id: item, doctor_slot_time: doctor_slot_time[index], fee_per_session: fee_per_session[index] });
                    console.log("data=>", fee_per_session[index], doctor_slot_time[index]);
                }

                if (Array.isArray(availabilityArray) && availabilityArray.length > 0) {
                    const data = await doctorModels.updateDoctorSessionSlots(doctorId, availabilityArray, item);
                    console.log("data=>", data);
                }

                // Convert CSV strings into arrays
                const skinTypeIds = skin_type_ids ? skin_type_ids[index] : [];
                const surgeryIds = surgery_ids ? surgery_ids[index] : [];
                const deviceIds = device_ids ? device_ids[index] : [];
                const clinicTreatments = treatments?.[index] || [];

                await doctorModels.deleteDoctorClincData({ doctor_id: doctorId, clinic_id: item, zynq_user_id: zynq_user_id });

                // Save expertis
                if (Array.isArray(clinicTreatments) && clinicTreatments.length > 0) {
                    await doctorModels.update_doctor_treatments(doctorId, clinicTreatments, item);
                }
                if (Array.isArray(skinTypeIds) && skinTypeIds.length > 0) {
                    console.log("skinTypeIds inserted");
                    await doctorModels.update_doctor_skin_types(doctorId, skinTypeIds, item);
                }
                if (Array.isArray(surgeryIds) && surgeryIds.length > 0) {
                    console.log("surgeryIds inserted");
                    await doctorModels.update_doctor_surgery(doctorId, surgeryIds, item);
                }
                if (Array.isArray(deviceIds) && deviceIds.length > 0) {
                    console.log("deviceIds inserted");
                    await doctorModels.update_doctor_treatment_devices(
                        zynq_user_id,       // zynq_user_id
                        clinicTreatments, // treatments array
                        deviceIds,       // device ids
                        item
                    );
                }
            }))


        return handleSuccess(res, 200, language, "DOCTOR_PROFILE_UPDATED_SUCCESSFULLY");

    } catch (error) {
        console.error("Error sending doctor invitation:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const updateSoloDoctorController = async (req, res) => {
    try {

        const schema = Joi.object({
            zynq_user_id: Joi.string().uuid().required(),
            slot_time: Joi.string().required(),
            same_for_all: Joi.string().valid("1", "0").optional().allow(null),
            name: Joi.string().max(255).optional().allow('', null),
            last_name: Joi.string().max(255).optional().allow('', null),
            age: Joi.string().optional().allow('', null),
            gender: Joi.string().optional().allow('', null),
            clinic_name: Joi.string().optional().allow('', null),
            clinic_description: Joi.string().optional().allow('', null),
            org_number: Joi.string().optional().allow('', null),
            street_address: Joi.string().optional().allow('', null),
            city: Joi.string().optional().allow('', null),
            state: Joi.string().optional().allow('', null),
            zip_code: Joi.string().optional().allow('', null),
            latitude: Joi.string().optional().allow('', null),
            longitude: Joi.string().optional().allow('', null),
            mobile_number: Joi.string().optional().allow('', null),
            website_url: Joi.string().optional().allow(null),
            address: Joi.string().optional().allow('', null),
            is_onboarded: Joi.number().integer().optional(),
            ivo_registration_number: Joi.string().optional().allow('', null),
            hsa_id: Joi.string().optional().allow('', null),
            form_stage: Joi.string().optional().allow('', null),
            education: Joi.array().items(Joi.object({
                institute: Joi.string().required(),
                degree: Joi.string().required(),
                start_year: Joi.string().required(),
                end_year: Joi.string().optional().allow(null)
            })).optional().allow(null),   // will be JSON
            experience: Joi.array().items(
                Joi.object({
                    organization: Joi.string().required(),
                    designation: Joi.string().required(),
                    start_date: Joi.string().required(),
                    end_date: Joi.string().optional().allow(null)
                })
            ).optional().allow(null),
            fee_per_session: Joi.string().optional().allow(null),
            currency: Joi.string().min(1).max(10).default('USD').optional(),
            session_duration: Joi.string().optional(),
            fee_range: Joi.string().optional().allow('', null),
            availability: Joi.array().items(
                Joi.object({
                    day_of_week: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
                    start_time: Joi.string().required().allow(''),
                    end_time: Joi.string().required().allow(''),
                    closed: Joi.number().integer().required()
                })
            ).optional(),
            treatments: Joi.array().items(
                Joi.object({
                    treatment_id: Joi.string().required(),
                    price: Joi.number().optional(),
                    sub_treatments: Joi.array().items(
                        Joi.object({
                            sub_treatment_id: Joi.string().required(),
                            sub_treatment_price: Joi.number().optional().allow(null, '')
                        })
                    ).optional()
                })
            ).optional(),

            skin_type_ids: Joi.array().items(Joi.string().uuid()).optional().allow(null),
            surgery_ids: Joi.array().items(Joi.string().uuid()).optional().allow(null),

            device_ids: Joi.array().items(Joi.string().uuid()).optional(),
            removed_file_ids: Joi.array().items(Joi.string()).optional().allow(null),
        });

        if (typeof req.body.treatments === "string") {
            try {
                req.body.treatments = JSON.parse(req.body.treatments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_TREATMENTS");
            }
        }

        if (typeof req.body.skin_type_ids === "string") {
            try {
                req.body.skin_type_ids = JSON.parse(req.body.skin_type_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKINTYPEID");
            }
        }

        if (typeof req.body.surgery_ids === "string") {
            try {
                req.body.surgery_ids = JSON.parse(req.body.surgery_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SURGERYID");
            }
        }

        if (typeof req.body.device_ids === "string") {
            try {
                req.body.device_ids = JSON.parse(req.body.device_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_DEVICEID");
            }
        }

        if (typeof req.body.removed_file_ids === "string") {
            try {
                req.body.removed_file_ids = JSON.parse(req.body.removed_file_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_REMOVED_IDS");
            }
        }

        if (typeof req.body.education === "string") {
            try {
                req.body.education = JSON.parse(req.body.education);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EDUCATION");
            }
        }

        if (typeof req.body.experience === "string") {
            try {
                req.body.experience = JSON.parse(req.body.experience);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EXPERIENCE");
            }
        }

        if (typeof req.body.availability === "string") {
            try {
                req.body.availability = JSON.parse(req.body.availability);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_AVAILABILITY");
            }
        }

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const {
            name,
            last_name,
            age,
            gender,
            clinic_name,
            clinic_description,
            org_number,
            street_address,
            city,
            state,
            zip_code,
            latitude,
            longitude,
            mobile_number,
            website_url,
            address,
            education,
            experience,
            treatments,
            fee_per_session,
            currency,
            session_duration,
            availability,
            skin_type_ids,
            surgery_ids,
            device_ids,
            ivo_registration_number,
            hsa_id,
            fee_range,
            slot_time,
            zynq_user_id,
            removed_file_ids,
            same_for_all
        } = value;

        const language = req.user.language || "en";

        const [clinic] = await clinicModels.get_clinic_by_zynq_user_id(
            zynq_user_id
        );
        const clinic_id = clinic.clinic_id;

        const clinic_logo = req?.files?.logo ? req?.files?.logo[0]?.filename : null;

        if (clinic_id) {
            const clinicData = buildClinicData({
                zynq_user_id: zynq_user_id ? zynq_user_id : clinic.zynq_user_id,
                clinic_name: clinic_name ? clinic_name : clinic.clinic_name,
                org_number: org_number ? org_number : clinic.org_number,
                email: clinic.email,
                mobile_number: mobile_number ? mobile_number : clinic.mobile_number,
                address: address ? address : clinic.address,
                fee_range: fee_range ? fee_range : clinic.fee_range,
                website_url: website_url ? website_url : clinic.website_url,
                clinic_description: clinic_description ? clinic_description : clinic.clinic_description,
                language: language ? language : clinic.language,
                clinic_logo: clinic_logo ? clinic_logo : clinic.clinic_logo,
                ivo_registration_number: ivo_registration_number ? ivo_registration_number : clinic.ivo_registration_number,
                hsa_id: hsa_id ? hsa_id : clinic.hsa_id,
                is_onboarded: clinic.is_onboarded
            });

            delete clinicData.state;
            delete clinicData.city;

            clinicData.same_for_all = same_for_all ? same_for_all : clinic.same_for_all;
            clinicData.slot_time = slot_time ? slot_time : clinic.slot_time;

            await clinicModels.updateClinicData(clinicData, clinic_id);

            const [clinicLocation] = await clinicModels.getClinicLocation(clinic_id);

            await clinicModels.updateClinicLocation({
                clinic_id,
                street_address: street_address ? street_address : clinicLocation.street_address,
                city: city ? city : clinicLocation.city,
                state: state ? state : clinicLocation.state,
                zip_code: zip_code ? zip_code : clinicLocation.zip_code,
                latitude: latitude ? latitude : clinicLocation.latitude,
                longitude: longitude ? longitude : clinicLocation.longitude,
            });
        }

        const [doctorResult] = await dbOperations.getData('tbl_doctors', `where zynq_user_id = '${zynq_user_id}' `);

        const doctorId = doctorResult?.doctor_id;

        if (doctorResult) {
            let doctorData = {
                name: name ? name : doctorResult.name,
                last_name: last_name ? last_name : doctorResult.last_name,
                gender: gender ? gender : doctorResult.gender,
                age: age ? age : doctorResult.age,
                biography: clinic_description ? clinic_description : doctorResult.biography,
                fee_per_session: fee_per_session ?? doctorResult.fee_per_session,
                address: address ? address : doctorResult.address,
                longitude: longitude ? longitude : doctorResult.longitude,
                profile_image: req?.files?.profile ? req?.files?.profile[0]?.filename : doctorResult.profile_image,
                phone: mobile_number ? mobile_number : doctorResult.phone,
                currency: currency ? currency : doctorResult.currency,
                session_duration: session_duration ? session_duration : doctorResult.session_duration,
            };


            let update_doctor = await dbOperations.updateData('tbl_doctors', doctorData, `WHERE zynq_user_id = '${zynq_user_id}' `);

        }


        const uploadedFiles = req.files || {};
        const clinicImageFiles = [];

        if (Array.isArray(uploadedFiles.files) && uploadedFiles.files.length > 0) {
            for (const file of uploadedFiles.files) {
                const fileName = file.filename;
                clinicImageFiles.push(fileName);
            }

            if (clinicImageFiles.length > 0) {
                await clinicModels.insertClinicImages(clinic_id, clinicImageFiles);
            }
        }



        const files = req.files;
        if (Object.keys(files).length > 0) { // Only process if new files are actually uploaded
            for (const key in files) { // 'key' is like 'medical_council', 'deramatology_board', etc.
                const certTypeFromDb = await doctorModels.get_certification_type_by_filename(key);

                if (certTypeFromDb.length > 0) {
                    const certification_type_id = certTypeFromDb[0].certification_type_id;

                    for (const file of files[key]) { // Loop through potential multiple files for the same field name
                        const newUploadPath = file.filename; // This is the new path

                        // Check if this certification type already exists for the doctor
                        const existingCert = await doctorModels.get_doctor_certification_by_type(doctorId, certification_type_id);

                        if (existingCert.length > 0) {
                            // Certification already exists, update its file path
                            await doctorModels.update_certification_upload_path(doctorId, certification_type_id, newUploadPath);

                        } else {
                            // Certification does not exist, add it
                            await doctorModels.add_certification(doctorId, certification_type_id, newUploadPath); // Add other metadata if available from req.body

                        }
                    }
                } else {
                    console.warn(`Certification type with filename key '${key}' not found in tbl_certification_type. Skipping file processing.`);
                }
            }
        }

        const eduArray = Array.isArray(education) ? education : [];
        const expArray = Array.isArray(experience) ? experience : [];

        if (eduArray.length > 0) {
            await doctorModels.delete_all_education(doctorId);
            for (let edu of eduArray) {
                await doctorModels.add_education(doctorId, edu.institute, edu.degree, edu.start_year, edu.end_year);
            }
        }

        if (expArray.length > 0) {
            await doctorModels.delete_all_experience(doctorId);
            for (let exp of expArray) {
                await doctorModels.add_experience(doctorId, exp.organization, exp.designation, exp.start_date, exp.end_date);
            }
        }

        if (availability?.length > 0) {
            const doctorSession = convertAvailability(availability, Number(slot_time));
            await doctorModels.updateDoctorSessionSlots(doctorId, doctorSession, clinic_id);
            const clinic_timing = mapAvailabilityToClinicTiming(availability);
            await clinicModels.updateClinicOperationHours(clinic_timing, clinic_id);
        }

        // Convert CSV strings into arrays
        const skinTypeIds = skin_type_ids ? skin_type_ids : [];
        const surgeryIds = surgery_ids ? surgery_ids : [];
        const deviceIds = device_ids ? device_ids : [];

        // Save expertis
        if (Array.isArray(treatments) && treatments.length > 0) {
            const mappedTreatments = mapTreatmentsForClinic(treatments);

            const treatmentsData =
                await clinicModels.createClinicMappedTreatments(
                    clinic_id,
                    mappedTreatments
                );

            await doctorModels.update_doctor_treatments(doctorId, treatments, clinic_id);
        }

        if (Array.isArray(removed_file_ids) && removed_file_ids.length > 0) {

            await clinicModels.deleteClinicImageModel(removed_file_ids);
        }

        if (skinTypeIds.length > 0) {
            await doctorModels.update_doctor_skin_types(doctorId, skinTypeIds, clinic_id);
            await clinicModels.updateClinicSkinTypes(skinTypeIds, clinic_id);
        }
        if (surgeryIds.length > 0) {
            await doctorModels.update_doctor_surgery(doctorId, surgeryIds, clinic_id);
            await clinicModels.updateClinicSurgeries(surgeryIds, clinic_id);
        }

        // NEW: Save treatment → user → device mapping
        if (deviceIds.length > 0 && Array.isArray(treatments)) {
            await doctorModels.update_doctor_treatment_devices(
                zynq_user_id,       // zynq_user_id
                treatments, // treatments array
                deviceIds,         // device ids
                clinic_id
            );
            await clinicModels.updateClinicAestheticDevices(
                deviceIds,
                clinic_id
            );
        };


        return handleSuccess(res, 200, language, "DOCTOR_PROFILE_UPDATED_SUCCESSFULLY");

    } catch (error) {
        console.error("Error sending doctor invitation:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

const generateSessions = (start, end, slotMinutes) => {
    const sessions = [];

    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);

    let startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    while (startMinutes + slotMinutes <= endMinutes) {
        const sH = String(Math.floor(startMinutes / 60)).padStart(2, '0');
        const sM = String(startMinutes % 60).padStart(2, '0');
        const eH = String(Math.floor((startMinutes + slotMinutes) / 60)).padStart(2, '0');
        const eM = String((startMinutes + slotMinutes) % 60).padStart(2, '0');

        sessions.push({
            start_time: `${sH}:${sM}:00`,
            end_time: `${eH}:${eM}:00`
        });

        startMinutes += slotMinutes;
    }

    return sessions.sort((a, b) => 
        a.start_time.localeCompare(b.start_time)
    );
};

export const generateAvailabilityFromOperationHours = async (req, res) => {
    try {
        const language = req?.user?.language || "en";
        
        const schema = Joi.object({
            slot_time: Joi.number().integer().positive().optional().allow(null),
            clinic_id: Joi.string().uuid().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let { slot_time, clinic_id } = value;

        const [clinic] = await clinicModels.get_clinic_by_id(clinic_id);

        if (!clinic) return handleError(res, 404, language, "CLINIC_NOT_FOUND");

        if (!slot_time) {
            slot_time = clinic.slot_time || 30;
        }

        const operationHours = await clinicModels.getClinicOperationHours(clinic_id);

        if (!operationHours) return handleError(res, 404, language, "OPERATION_HOURS_NOT_FOUND");

        // Day order and mapping
        const dayOrder = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday"
        ];

        const dayMapSv = {
            Monday: "Måndag",
            Tuesday: "Tisdag",
            Wednesday: "Onsdag",
            Thursday: "Torsdag",
            Friday: "Fredag",
            Saturday: "Lördag",
            Sunday: "Söndag"
        };

        const availability = [];
        const slotSummary = {};

        for (const dayData of operationHours) {
            const { day_of_week, open_time, close_time, is_closed } = dayData;

            let sessions = [];

            if (!is_closed) {
                sessions = generateSessions(open_time, close_time, slot_time);
            }

            // Map day name based on language
            const displayDay = language === "en" 
                ? day_of_week 
                : dayMapSv[day_of_week] || day_of_week;

            availability.push({
                day: displayDay,
                session: sessions
            });

            slotSummary[displayDay] = sessions.length;
        }

        // Sort availability by day order
        availability.sort((a, b) => {
            // Get English day names for sorting
            const getDayKey = (day) => {
                // If Swedish, find the English key
                if (language !== "en") {
                    return Object.keys(dayMapSv).find(key => dayMapSv[key] === day) || day;
                }
                return day;
            };
            
            const dayA = getDayKey(a.day);
            const dayB = getDayKey(b.day);
            
            return dayOrder.indexOf(dayA) - dayOrder.indexOf(dayB);
        });

        return handleSuccess(
            res,
            200,
            language,
            "SLOT_GENERATED_SUCCESSFULLY",
            availability || [],
        );
    } catch (error) {
        console.error("Error in generateAvailabilityFromOperationHours:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};


// export const generateAvailabilityFromOperationHours = async (req, res) => {
//     try {
//         const language = req?.user?.language || "en";
//         const schema = Joi.object({
//             slot_time: Joi.number().integer().positive().optional().allow(null),
//             clinic_id: Joi.string().uuid().required()
//         });

//         const { error, value } = schema.validate(req.body);
//         if (error) return joiErrorHandle(res, error);

//         let { slot_time, clinic_id } = value;

//         const [clinic] = await clinicModels.get_clinic_by_id(clinic_id);

//         if (!clinic) return handleError(res, 404, language, "CLINIC_NOT_FOUND");

//         if (!slot_time) {
//             slot_time = clinic.slot_time || 30;
//         }

//         const operationHours = await clinicModels.getClinicOperationHours(clinic_id);

//         if (!operationHours) return handleError(res, 404, language, "OPERATION_HOURS_NOT_FOUND");

//         const availability = [];
//         const slotSummary = {};

//         for (const dayData of operationHours) {
//             const { day_of_week, open_time, close_time, is_closed } = dayData;

//             let sessions = [];

//             if (!is_closed) {
//                 sessions = generateSessions(open_time, close_time, slot_time);
//             }

//             availability.push({
//                 day: day_of_week,
//                 session: sessions
//             });

//             slotSummary[day_of_week] = sessions.length;
//         }

//         return handleSuccess(
//             res,
//             200,
//             language,
//             "SLOT_GENERATED_SUCCESSFULLY",
//             availability || [],
//         );
//     } catch (error) {
//         console.error("Error in getAllSurgery:", error);
//         return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
//     }
// };

export const unsyncClinicController = async (req, res) => {
    try {
        const language = req?.user?.language || "en";
        const schema = Joi.object({
            clinic_id: Joi.string().uuid().required(),
            doctor_id: Joi.string().uuid().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let { clinic_id, doctor_id } = value;

        let clinics = await clinicModels.getDoctorClinicMappedDataModel(doctor_id, clinic_id);

        if (clinics.length == 0) return handleError(res, 404, "en", "CLINIC_NOT_FOUND");

        await clinicModels.unsynkClinicModel(doctor_id, clinic_id);


        return handleSuccess(res, 200, language, "CLINIC_UNSYNCED_SUCCESSFULLY");
    } catch (error) {
        console.error("Error in unsyncClinicController:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};


export const getDoctorInvitationListController = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';

        // Fetch filtered clinics
        const doctors = await adminModels.getDoctorInvitaionListModel();

        return handleSuccess(res, 200, language, "Fetch Doctor Invitation List Successfully", doctors);

    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const getClinicInvitationListController = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';

        const page = parseInt(req.query.page) || 1;
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        const offset = limit ? (page - 1) * limit : 0;
        const search = req.query.search || "";
        const status = req.query.status || "";
        const type = req.query.type || "";
        const sortBy = req.query.sortBy || "created_at";
        const sortOrder = req.query.sortOrder || "DESC";

        const [doctors, total] = await Promise.all([
            adminModels.getClinicInvitaionListModel({ limit, offset, search, status, type, sortBy, sortOrder }),
            adminModels.get_clinic_invitation_count({ search, status, type })
        ]);

        if (!req.query.limit && !req.query.page) {
            return handleSuccess(res, 200, language, "Fetch Clinic Invitation List Successfully", doctors);
        }

        const response = {
            clinics: doctors,
            total,
            page,
            limit: limit || total,
            totalPages: limit ? Math.ceil(total / limit) : 1
        };

        return handleSuccess(res, 200, language, "Fetch Clinic Invitation List Successfully", response);

    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const sendDoctorInvitationListController = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';
        const schema = Joi.object({
            zynqUser_ids: Joi.array().items(Joi.string().uuid()).min(1).required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { zynqUser_ids } = value;

        // Fetch filtered clinics
        const doctors = await adminModels.checkDoctorIdsInvitaionListModel(zynqUser_ids);


        if (doctors.length == 0) return handleError(res, 404, language, "DOCTOR_NOT_FOUND");


        await Promise.all(
            doctors?.map(async (doctor) => {


                const [clinicData] = await clinicModels.getClinicProfile(doctor.clinic_id);

                const [get_location] = await clinicModels.get_clinic_location_by_clinic_id(doctor.clinic_id);

                let sendPassword = doctor?.show_password;

                if (doctor.user_type == "Doctor") {

                    const emailTemplatePath = path.resolve(__dirname, "../../views/doctor_invite/en.ejs");

                    const emailTemplatePath2 = path.resolve(__dirname, "../../views/doctor_invite/enn.ejs");
                    const invitation_id = doctor?.map_id;


                    const emailHtml = await ejs.renderFile(language == "en" ? emailTemplatePath : emailTemplatePath2, {
                        clinic_name: clinicData?.clinic_name || "#N/A",
                        clinic_org_number: clinicData?.org_number || "#N/A",
                        clinic_city: get_location?.city || "#N/A",
                        clinic_street_address: get_location?.street_address || "#N/A",
                        clinic_state: get_location?.state || "#N/A",
                        clinic_zip: get_location?.zip_code || "#N/A",
                        clinic_phone: clinicData?.mobile_number || "#N/A",
                        clinic_email: clinicData?.email,
                        email: doctor.email,
                        password: sendPassword,
                        image_logo,
                        invitation_id,
                        invitation_link: `${APP_URL}clinic/accept-invitation?invitation_id=${invitation_id}`,
                    });

                    const emailOptions = {
                        to: doctor.email,
                        subject: "Professional Invitation",
                        html: emailHtml,
                    };
                    await sendEmail(emailOptions);

                    let update_doctor = await dbOperations.updateData('tbl_doctors', { profile_status: "INVITED" }, `WHERE zynq_user_id = '${doctor.zynq_user_id}' `);

                } else {


                    const is_subscribed = doctor?.clinic_id;

                    const html = await ejs.renderFile(
                        path.join(__dirname, "../../views/invitation-mail.ejs"),
                        {
                            clinic_name: clinicData?.clinic_name || "#N/A",
                            organization_number: clinicData?.org_number || "#N/A",
                            email: doctor.email,
                            phone: clinicData?.mobile_number || "#N/A",
                            city: get_location?.city || "#N/A",
                            postal_code: get_location?.zip_code || "#N/A",
                            address: doctor?.address || "#N/A",
                            password: sendPassword,
                            logo: image_logo,
                            invitationLink: `${APP_URL}admin/subscribed/${is_subscribed}`,
                        }
                    );

                    let update_doctor = await dbOperations.updateData('tbl_doctors', { profile_status: "INVITED" }, `WHERE zynq_user_id = '${doctor.zynq_user_id}' `);

                    let update_clinic = await dbOperations.updateData('tbl_clinics', { profile_status: "INVITED" }, `WHERE zynq_user_id = '${doctor.zynq_user_id}' `);

                    await sendEmail({
                        to: doctor.email,
                        subject: "You're One Step Away from Joining ZYNQ – Accept Your Invite",
                        html,
                    });


                }
            })
        );



        return handleSuccess(res, 200, language, "INVITATION_SENT_SUCCESSFULLY",);

    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

// ✅ DELETE EXPERT — with active appointment check
export const deleteExpertController = async (req, res) => {
    try {
        const language = 'en';
        const { doctor_id } = req.params;

        if (!doctor_id) {
            return handleError(res, 400, language, "Expert ID is required.");
        }

        // 1. Check if expert exists
        const doctorRows = await adminModels.getDoctorById(doctor_id);
        if (!doctorRows || doctorRows.length === 0) {
            return handleError(res, 404, language, "Expert not found.");
        }

        const doctor = doctorRows[0];
        const expertName = `${doctor.first_name || ''} ${doctor.last_name || ''}`.trim() || 'This expert';

        // 2. Check for active appointments
        const activeAppointments = await adminModels.checkDoctorActiveAppointments(doctor_id);
        if (activeAppointments && activeAppointments.length > 0) {
            const appt = activeAppointments[0];
            const isOngoing = appt.status !== 'Upcoming' && appt.status !== 'Rescheduled';
            const statusLabel = isOngoing ? 'Ongoing' : appt.status;

            return handleError(res, 409, language,
                `Expert "${expertName}" cannot be deleted because they have an ${statusLabel} appointment (ID: ${appt.appointment_id}). Please complete or cancel all active appointments before deleting this expert.`
            );
        }

        // 3. Soft delete the expert
        await adminModels.softDeleteDoctorById(doctor_id);

        return handleSuccess(res, 200, language, "Expert deleted successfully.", {
            doctor_id,
            expert_name: expertName,
        });

    } catch (error) {
        console.error("deleteExpertController error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};