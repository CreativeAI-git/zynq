import Joi from "joi";
import dotenv from "dotenv";
import * as doctorModels from "../../models/doctor.js";
import { asyncHandler, handleError, handleSuccess, joiErrorHandle } from "../../utils/responseHandler.js";
import { get_web_user_by_id, getUserDataByRole, update_onboarding_status } from "../../models/web_user.js";
import { createChat, fetchChatById, insertChatUsersActive, toActivateUsers } from "../../models/chat.js";
import { getIO, getUserSockets } from '../../utils/socketManager.js';
import dbOperations from '../../models/common.js';
import { get_product_images_by_product_ids } from "../../models/api.js";
import { getDoctorBookedAppointmentsModel } from "../../models/appointment.js";
import { applyLanguageOverwrite, extractUserData } from "../../utils/misc.util.js";
import { generateDoctorsEmbeddingsV2 } from "../api/embeddingsController.js";
import { addSubTreatmentsModel, addTreatmentConcernsModel, addTreatmentModel, checkExistingTreatmentModel, deleteExistingConcernsModel, deleteExistingSubTreatmentsModel, updateTreatmentModel } from "../../models/admin.js";
import { getClinicOperationHours, updateClinicOperationHours } from "../../models/clinic.js";
import { convertAvailability, mapAvailabilityToClinicTiming } from "../admin/doctorController.js";
dotenv.config();

//const APP_URL = process.env.APP_URL;
const APP_URL = process.env.LOCAL_APP_URL;
const image_logo = process.env.LOGO_URL;







export const addPersonalInformation = async (req, res) => {
    try {
        const schema = Joi.object({
            name: Joi.string().max(255).required(),
            phone: Joi.string().max(255).required(),
            age: Joi.string().optional().allow('', null),
            address: Joi.string().max(255).required(),
            gender: Joi.string().optional().allow('', null),
            biography: Joi.string().optional().allow(''),
            last_name: Joi.string().optional().allow('', null),
            city: Joi.string().max(255).optional().allow('', null),
            zip_code: Joi.string().max(255).optional().allow('', null),
            latitude: Joi.number().optional().allow(null).empty('').default(null),
            longitude: Joi.number().optional().allow(null).empty('').default(null),
            slot_time: Joi.number().optional(),
            email: Joi.string().optional().allow('', null),
        });

        let language = req?.user?.language || 'en';

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let filename = '';
        if (req.file) {
            filename = req.file.filename
        }
        const zynqUserId = req.user.id;
        const [doctorData] = await doctorModels.get_doctor_by_zynquser_id(zynqUserId);


        const result = await doctorModels.add_personal_details(zynqUserId, value.name, value.phone, value.age, value.address, value.city, value.zip_code, value.latitude, value.longitude, value.gender, filename, value.biography, value.last_name, value.slot_time, "ONBOARDING");

        if (result.affectedRows) {
            await update_onboarding_status(1, zynqUserId)
            return handleSuccess(res, 201, language, "DOCTOR_PERSONAL_DETAILS_ADDED", result.affectedRows);
        } else {
            return handleError(res, 500, language, 'FAILED_TO_ADD_PERSONAL_DETAILS');
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const addEducationAndExperienceInformation = async (req, res) => {
    try {
        const schema = Joi.object({
            education: Joi.string().required(),   // will be JSON
            experience: Joi.string().required(), // will be JSON
        });

        let language = req?.user?.language || 'en';

        const payload = {
            education: req.body.education,
            experience: req.body.experience
        };

        const { error, value } = schema.validate(payload);
        if (error) return joiErrorHandle(res, error);

        const doctorId = req.user.doctorData.doctor_id;

        const educationList = JSON.parse(value.education);
        const experienceList = JSON.parse(value.experience);

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
        // --- END IMPROVED LOGIC ---



        await doctorModels.delete_all_education(doctorId);
        await doctorModels.delete_all_experience(doctorId);

        // Save Education
        for (let edu of educationList) {
            await doctorModels.add_education(
                doctorId,
                edu.institute,
                edu.degree,
                edu.start_year,
                edu.end_year,

            );
        }

        // Save Experience
        for (let exp of experienceList) {
            await doctorModels.add_experience(
                doctorId,
                exp.organization,
                exp.designation,
                exp.start_date,
                exp.end_date
            );
        }
        const zynqUserId = req.user.id
        await update_onboarding_status(2, zynqUserId)
        return handleSuccess(res, 201, language, "DOCTOR_PROFILE_INFO_ADDED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const addExpertise = async (req, res) => {
    try {

        // Day name mapping from Swedish to English
        const dayMapSwToEn = {
            "Måndag": "Monday",
            "Tisdag": "Tuesday",
            "Onsdag": "Wednesday",
            "Torsdag": "Thursday",
            "Fredag": "Friday",
            "Lördag": "Saturday",
            "Söndag": "Sunday"
        };

        // Custom Joi validation for day names (accepts both English and Swedish)
        const dayValidation = Joi.string()
            .custom((value, helpers) => {
                const validEnglishDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                const validSwedishDays = Object.keys(dayMapSwToEn);

                if (validEnglishDays.includes(value) || validSwedishDays.includes(value)) {
                    // Convert Swedish to English if needed
                    return dayMapSwToEn[value] || value;
                }

                return helpers.error('any.invalid');
            })
            .required()
            .messages({
                'any.invalid': 'Day must be a valid day name in English or Swedish'
            });


        const schema = Joi.object({
            clinic_id: Joi.array().items(Joi.string().uuid()).min(1).required(),
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
                ).optional()
            ).optional(),

            fee_per_session: Joi.array().items(Joi.alternatives()
                .try(Joi.string(), Joi.number())
                .optional()
                .allow(null)).optional().allow(null),
            doctor_slot_time: Joi.array().items(Joi.alternatives()
                .try(Joi.string(), Joi.number())
                .optional()
                .allow(null)).optional().allow(null),


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
                        // day: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
                        day: dayValidation,
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
        });

        let language = req?.user?.language || 'en';
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { clinic_id, treatments, skin_type_ids, surgery_ids, device_ids, availability, doctor_slot_time, fee_per_session } = value;

        const doctorId = req.user.doctorData.doctor_id;
        const zynqUserId = req.user.id;

        await Promise.all(
            clinic_id.map(async (item, index) => {

                if (Array.isArray(doctor_slot_time) && doctor_slot_time.length > 0 || Array.isArray(fee_per_session) && fee_per_session.length > 0) {
                    const data = await doctorModels.updateDoctorSlotTimeAndCunsultationFeeOfClinicModel({ doctor_id: doctorId, clinic_id: item, doctor_slot_time: doctor_slot_time[index], fee_per_session: fee_per_session[index] });
                    console.log("data=>", fee_per_session[index], doctor_slot_time[index]);
                }

                const availabilityArray = availability ? availability[index] : [];
                console.log("availabilityArray=>", availabilityArray);

                if (Array.isArray(availabilityArray) && availabilityArray.length > 0) {
                    const data = await doctorModels.updateDoctorSessionSlots(doctorId, availabilityArray, item);
                    console.log("data=>", data);
                }

                // Convert CSV strings into arrays
                const skinTypeIds = skin_type_ids ? skin_type_ids[index] : [];
                const surgeryIds = surgery_ids ? surgery_ids[index] : [];
                const deviceIds = device_ids ? device_ids[index] : [];
                const clinicTreatments = treatments?.[index] || [];

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
                        zynqUserId,       // zynq_user_id
                        clinicTreatments, // treatments array
                        deviceIds,       // device ids
                        item
                    );
                }
            }));

        await update_onboarding_status(3, zynqUserId);
        return handleSuccess(res, 200, language, "EXPERTISE_UPDATED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const addConsultationFeeAndAvailability = async (req, res) => {
    try {
        const schema = Joi.object({
            fee_per_session: Joi.number().positive().optional(),
            currency: Joi.string().min(1).max(10).default('USD').optional(),
            session_duration: Joi.string().optional(),
        });
        let language = req?.user?.language || 'en';
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);
        const doctorId = req.user.doctorData.doctor_id;
        await doctorModels.update_consultation_fee(doctorId, value.fee_per_session, "USD", value.session_duration);

        const zynqUserId = req.user.id
        await update_onboarding_status(4, zynqUserId)
        // await generateDoctorsEmbeddingsV2(zynqUserId)
        return handleSuccess(res, 200, language, "FEE_AVAILABILITY_ADDED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const getDoctorProfile = async (req, res) => {
    try {
        const language = req?.user?.language || "en";
        const doctorId = req.user.doctorData.doctor_id;
        const zynqUserId = req.user.id;

        const profileData = await doctorModels.get_doctor_profile(doctorId, language, zynqUserId);

        let completionPercentage = 0;
        let filledFieldsCount = 0;
        let totalFieldsCount = 0;

        // Personal Details
        const personalFields = ['name', 'phone', 'age', 'address', 'gender', 'profile_image', 'biography'];
        totalFieldsCount += personalFields.length;
        personalFields.forEach(field => {
            if (profileData[field]) filledFieldsCount++;
        });

        // Education
        totalFieldsCount += 1;
        if (profileData.education && profileData.education.length > 0) filledFieldsCount++;

        // Experience
        totalFieldsCount += 1;
        if (profileData.experience && profileData.experience.length > 0) filledFieldsCount++;

        // Expertise
        const expertiseCategories = ['treatments', 'skinTypes', 'severityLevels', 'skinCondition', 'surgery', 'aestheticDevices'];
        totalFieldsCount += expertiseCategories.length;
        expertiseCategories.forEach(category => {
            if (profileData[category] && profileData[category].length > 0) filledFieldsCount++;
        });

        // Fee & Availability
        totalFieldsCount += 2;
        if (profileData.consultationFee && profileData.consultationFee.fee_per_session) filledFieldsCount++;
        if (profileData.availability && profileData.availability.length > 0) filledFieldsCount++;

        totalFieldsCount += 1;
        if (profileData.certifications && profileData.certifications.length > 0) filledFieldsCount++;

        completionPercentage = totalFieldsCount > 0 ? Math.round((filledFieldsCount / totalFieldsCount) * 100) : 0;



        if (profileData && profileData.profile_image && !profileData.profile_image.startsWith("http")) {
            profileData.profile_image = `${APP_URL}doctor/profile_images/${profileData.profile_image}`;
        }

        if (profileData.certifications && Array.isArray(profileData.certifications)) {
            profileData.certifications.forEach(certification => {
                if (certification.upload_path && !certification.upload_path.startsWith("http")) {
                    certification.upload_path = `${APP_URL}doctor/certifications/${certification.upload_path}`;
                }
            });
        }
        // applyLanguageOverwrite({ ...profileData, completionPercentage }, language)
        return handleSuccess(res, 200, language, "DOCTOR_PROFILE_RETRIEVED", { ...profileData, completionPercentage });
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const editPersonalInformation = async (req, res) => {
    try {
        const schema = Joi.object({
            name: Joi.string().max(255).optional(),
            phone: Joi.string().max(255).optional(),
            age: Joi.string().max(255).optional(),
            address: Joi.string().max(255).optional(),
            gender: Joi.string().max(255).optional(),
            biography: Joi.string().optional().allow(''),
            last_name: Joi.string().optional().allow('', null),
            city: Joi.string().max(255).optional().allow('', null),
            zip_code: Joi.string().max(255).optional().allow('', null),
            latitude: Joi.number().optional().allow(null).empty('').default(null),
            longitude: Joi.number().optional().allow(null).empty('').default(null),
            slot_time: Joi.number().optional(),
        });
        let language = req?.user?.language || 'en';

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);



        const zynqUserId = req.user.id;
        const [doctorData] = await doctorModels.get_doctor_by_zynquser_id(zynqUserId);

        if (!doctorData) {
            return handleError(res, 404, language, "DOCTOR_NOT_FOUND");
        }
        let filename = doctorData.profile_image;
        if (req.file) {
            filename = req.file.filename
        }
        // await generateDoctorsEmbeddingsV2(doctorData.doctor_id)
        const result = await doctorModels.add_personal_details(zynqUserId, value.name, value.phone, value.age, value.address, value.city, value.zip_code, value.latitude, value.longitude, value.gender, filename, value.biography, value.last_name, value.slot_time, "ONBOARDING");
        // await generateDoctorsEmbeddingsV2(zynqUserId)
        if (result.affectedRows > 0) {
            return handleSuccess(res, 200, language, "DOCTOR_PERSONAL_DETAILS_UPDATED", result.affectedRows);
        } else if (result.affectedRows === 0) {
            return handleSuccess(res, 200, language, "NO_CHANGES_MADE", {});
        } else {
            return handleError(res, 500, language, 'FAILED_TO_UPDATE_PERSONAL_DETAILS');
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const addEducation = async (req, res) => {
    try {
        const schema = Joi.object({
            education: Joi.string().required(),   // will be JSON
        });

        let language = req?.user?.language || 'en';

        const payload = {
            education: req.body.education,
        };

        const { error, value } = schema.validate(payload);
        if (error) return joiErrorHandle(res, error);

        const doctorId = req.user.doctorData.doctor_id;

        const educationList = JSON.parse(value.education);

        // Save Education
        for (let edu of educationList) {
            await doctorModels.add_education(
                doctorId,
                edu.institute,
                edu.degree,
                edu.start_year,
                edu.end_year,

            );
        }

        return handleSuccess(res, 201, language, "EDUCATION_ADDED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const editEducation = async (req, res) => {
    try {
        const schema = Joi.object({
            education_id: Joi.string().uuid().required(),
            institute: Joi.string().min(3).max(255).optional(),
            degree: Joi.string().min(2).max(255).optional(),
            start_year: Joi.string().optional(),
            end_year: Joi.string().optional(),
        });

        const zynqUserId = req.user.id;
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let language = req?.user?.language || 'en';

        const result = await doctorModels.update_education(
            value.education_id,
            value.institute,
            value.degree,
            value.start_year,
            value.end_year
        );

        // await generateDoctorsEmbeddingsV2(zynqUserId)

        if (result.affectedRows > 0) {
            return handleSuccess(res, 200, language, "EDUCATION_UPDATED_SUCCESSFULLY", result.affectedRows);
        } else {
            return handleSuccess(res, 200, language, "NO_CHANGES_MADE", {});
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const deleteEducation = async (req, res) => {
    try {
        const schema = Joi.object({
            education_id: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.params);
        if (error) return joiErrorHandle(res, error);


        let language = req?.user?.language || 'en';

        const result = await doctorModels.delete_education(value.education_id);

        if (result.affectedRows > 0) {
            return handleSuccess(res, 200, language, "EDUCATION_DELETED", result.affectedRows);
        } else {
            return handleError(res, 500, language, 'EDUCATION_NOT_FOUND');
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const addExperince = async (req, res) => {
    try {
        const schema = Joi.object({
            experience: Joi.string().required(), // will be JSON
        });

        let language = req?.user?.language || 'en';

        const payload = {
            experience: req.body.experience
        };

        const { error, value } = schema.validate(payload);
        if (error) return joiErrorHandle(res, error);

        const doctorId = req.user.doctorData.doctor_id;
        const experienceList = JSON.parse(value.experience);

        // Save Experience
        for (let exp of experienceList) {
            await doctorModels.add_experience(
                doctorId,
                exp.organization,
                exp.designation,
                exp.start_date,
                exp.end_date
            );
        }
        return handleSuccess(res, 201, language, "EXPERIENCE_ADDED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const editExperience = async (req, res) => {
    try {
        const schema = Joi.object({
            experience_id: Joi.string().uuid().required(),
            organization: Joi.string().min(3).max(255).optional(),
            designation: Joi.string().min(2).max(255).optional(),
            start_date: Joi.string().optional(),
            end_date: Joi.string().optional(),
        });
        const zynqUserId = req.user.id;
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const result = await doctorModels.update_experience(
            value.experience_id,
            value.organization,
            value.designation,
            value.start_date,
            value.end_date
        );

        let language = req?.user?.language || 'en';

        if (result.affectedRows > 0) {
            // await generateDoctorsEmbeddingsV2(zynqUserId)
            return handleSuccess(res, 200, language, "EXPERIENCE_UPDATED", result.affectedRows);
        } else {
            return handleSuccess(res, 200, language, "NO_CHANGES_MADE", {});
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const deleteExperience = async (req, res) => {
    try {
        const schema = Joi.object({
            experience_id: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.params);
        if (error) return joiErrorHandle(res, error);

        const result = await doctorModels.delete_experience(value.experience_id);
        let language = req?.user?.language || 'en';
        if (result.affectedRows > 0) {
            return handleSuccess(res, 200, language, "EXPERIENCE_DELETED", result.affectedRows);
        } else {
            return handleError(res, 500, language, 'EXPERIENCE_NOT_FOUND');
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const editExpertise = async (req, res) => {
    try {
        const schema = Joi.object({
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

            skin_type_ids: Joi.string().allow("", null).optional(),
            severity_levels_ids: Joi.string().allow("", null).optional(),
            skin_condition_ids: Joi.string().allow("", null).optional(),
            surgery_ids: Joi.string().allow("", null).optional(),
            device_ids: Joi.string().allow("", null).optional()
        });

        let language = req?.user?.language || 'en';
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const doctorId = req.user.doctorData.doctor_id;
        const zynqUserId = req.user.id;

        // --------- HELPER: SAFE PARSE CSV ----------
        const parseIds = (ids) => {
            if (ids === undefined) return undefined; // means do not update this field
            if (ids === "" || ids === null) return []; // empty → clear records
            return ids.split(",").map(id => id.trim());
        };

        // --------- TREATMENTS ----------
        if (value.treatments !== undefined) {
            await doctorModels.update_doctor_treatments(doctorId, value.treatments);
        }

        // --------- OTHER FIELDS ----------
        const skinTypeIds = parseIds(value.skin_type_ids);
        if (skinTypeIds !== undefined) {
            await doctorModels.update_doctor_skin_types(doctorId, skinTypeIds);
        }

        const severityIds = parseIds(value.severity_levels_ids);
        if (severityIds !== undefined) {
            await doctorModels.update_doctor_severity_levels(doctorId, severityIds);
        }

        const skinConditionIds = parseIds(value.skin_condition_ids);
        if (skinConditionIds !== undefined) {
            await doctorModels.update_doctor_skin_conditions(doctorId, skinConditionIds);
        }

        const surgeryIds = parseIds(value.surgery_ids);
        if (surgeryIds !== undefined) {
            await doctorModels.update_doctor_surgery(doctorId, surgeryIds);
        }

        // --------- DEVICE IDS ----------
        const deviceIds = parseIds(value.device_ids);
        if (deviceIds !== undefined) {
            await doctorModels.update_doctor_treatment_devices(
                zynqUserId,
                value.treatments,
                deviceIds
            );
        }

        return handleSuccess(res, 200, language, "DOCTOR_PERSONAL_DETAILS_UPDATED", {});

    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const addCertifications = async (req, res) => {
    try {

        let language = req?.user?.language || 'en';

        const doctorId = req.user.doctorData.doctor_id;

        const files = req.files;

        for (const key in files) {
            const certType = await doctorModels.get_certification_type_by_filename(key)

            if (certType.length > 0) {
                const certification_type_id = certType[0].certification_type_id;

                for (const file of files[key]) {
                    await doctorModels.add_certification(doctorId, certification_type_id, file.filename)
                }
            }
        }

        return handleSuccess(res, 201, language, "CERTIFICATION_ADDED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const editCertification = async (req, res) => {
    try {
        const schema = Joi.object({
            doctor_certification_id: Joi.string().uuid().required(),
        });
        const zynqUserId = req?.user?.id;
        let language = req?.user?.language || 'en';
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const result = await doctorModels.update_certification(req.file.filename, value.doctor_certification_id);

        if (result.affectedRows > 0) {
            // await generateDoctorsEmbeddingsV2(zynqUserId)
            return handleSuccess(res, 200, language, "CERTIFICATION_UPDATED", result.affectedRows);
        } else {
            return handleSuccess(res, 200, language, "NO_CHANGES_MADE", {});
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const deleteCertification = async (req, res) => {
    try {
        const schema = Joi.object({
            doctor_certification_id: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.params);
        if (error) return joiErrorHandle(res, error);

        const result = await doctorModels.delete_certification(value.doctor_certification_id);
        let language = req?.user?.language || 'en';
        if (result.affectedRows > 0) {
            return handleSuccess(res, 200, language, "CERTIFICATION_DELETED", result.affectedRows);
        } else {
            return handleError(res, 500, language, 'CERTIFICATION_NOT_FOUND');
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const editConsultationFeeAndAvailability = async (req, res) => {
    try {
        let language = req?.user?.language || 'en';
        let { doctor_availability_id } = req.params;
        const zynqUserId = req?.user?.id;

        await doctorModels.update_docter_availability(req.body, doctor_availability_id);
        return handleSuccess(res, 200, language, "DOCTOR_PERSONAL_DETAILS_UPDATED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const getLinkedClinics = async (req, res) => {
    try {
        const language = 'en';
        const doctorId = req.user.doctorData.doctor_id; // Assuming doctorId is available in req.user

        const profileData = await doctorModels.get_clinics_data_by_doctor_id(doctorId);

        return handleSuccess(res, 200, language, "DOCTOR_PROFILE_RETRIEVED", profileData);
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const calculateProfileCompletionPercentageByDoctorId = async (doctorId, user_type, clinic_id) => {
    try {

        const profileData = await doctorModels.get_doctor_profile(doctorId);
        if (!profileData) {
            return 0;
        }

        let filledFieldsCount = 0;
        let totalFieldsCount = 0;

        const missingSummary = {}; // Store missing fields by category

        // ---------- PERSONAL DETAILS ----------
        const personalFields = ['name', 'phone', 'address'];
        totalFieldsCount += personalFields.length;

        const missingPersonal = personalFields.filter(field => !profileData[field]);
        filledFieldsCount += personalFields.length - missingPersonal.length;
        missingSummary.personal = missingPersonal;

        // ---------- EDUCATION ----------
        // totalFieldsCount += 1;
        // const hasEducation = profileData.education && profileData.education.length > 0;
        // if (hasEducation) filledFieldsCount++;
        // else missingSummary.education = ["education"];

        // ---------- EXPERIENCE ----------
        // totalFieldsCount += 1;
        // const hasExperience = profileData.experience && profileData.experience.length > 0;
        // if (hasExperience) filledFieldsCount++;
        // else missingSummary.experience = ["experience"];

        // ---------- EXPERTISE ----------
        const expertiseCategories = [
            'treatments',
        ];

        totalFieldsCount += expertiseCategories.length;

        const missingExpertise = [];
        // expertiseCategories.forEach(category => {
        //     const hasData = profileData[category] && profileData[category].length > 0;
        //     if (hasData) filledFieldsCount++;
        //     else missingExpertise.push(category);
        // });
        expertiseCategories.forEach(category => {
            const hasData =
                Array.isArray(profileData.clinics) &&
                profileData.clinics.some(
                    clinic =>
                        Array.isArray(clinic[category]) &&
                        clinic[category].length > 0
                );

            if (hasData) {
                filledFieldsCount++;
            } else {
                missingExpertise.push(category);
            }
        });

        missingSummary.expertise = missingExpertise;

        // ---------- AVAILABILITY ----------
        totalFieldsCount += 1;

        // const hasAvailability = hasAvailability = profileData.clinics && profileData.availability.length > 0;

        let hasAvailability;

        if (user_type == "Doctor") {
            hasAvailability = Array.isArray(profileData.clinics) &&
                profileData.clinics.some(
                    clinic => Array.isArray(clinic.slots) && clinic.slots.length > 0
                )
        } else {
            let availability = []
            if (clinic_id) {
                availability = await getClinicOperationHours(clinic_id);
            }
            hasAvailability = availability && availability.length > 0;
        }

        if (hasAvailability) filledFieldsCount++;
        else missingSummary.availability = ["availability"];

        // ---------- FINAL CALCULATION ----------
        const completionPercentage = totalFieldsCount > 0
            ? Math.round((filledFieldsCount / totalFieldsCount) * 100)
            : 0;

        return completionPercentage;

    } catch (error) {
        console.error("❌ Error calculating profile completion:", error);
        return 0;
    }
};


export const editEducationAndExperienceInformation = async (req, res) => {
    try {
        const schema = Joi.object({
            education: Joi.string().optional(),
            experience: Joi.string().optional(),
        });

        let language = req?.user?.language || 'en';

        const payload = {
            education: req.body.education,
            experience: req.body.experience
        };

        const { error, value } = schema.validate(payload);
        if (error) return joiErrorHandle(res, error);

        const doctorId = req.user.doctorData.doctor_id;
        const zynqUserId = req.user.id;
        const educationList = JSON.parse(value.education);
        const experienceList = JSON.parse(value.experience);

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

        await doctorModels.delete_all_education(doctorId);
        await doctorModels.delete_all_experience(doctorId);

        // Save Education
        for (let edu of educationList) {
            await doctorModels.add_education(
                doctorId,
                edu.institute,
                edu.degree,
                edu.start_year,
                edu.end_year,

            );
        }

        // Save Experience
        for (let exp of experienceList) {
            await doctorModels.add_experience(
                doctorId,
                exp.organization,
                exp.designation,
                exp.start_date,
                exp.end_date
            );
        }
        // await generateDoctorsEmbeddingsV2(zynqUserId)
        return handleSuccess(res, 201, language, "DOCTOR_PERSONAL_DETAILS_UPDATED", {});
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const deleteProfileImage = async (req, res) => {
    try {
        const doctorId = req.user.doctorData.doctor_id;
        const result = await doctorModels.delete_profile_image(doctorId);
        const language = req?.user?.language || 'en';
        if (result.affectedRows > 0) {
            return handleSuccess(res, 200, language, "PROFILE_IMAGE_DELETED", result.affectedRows);
        } else {
            return handleError(res, 500, language, 'CERTIFICATION_NOT_FOUND');
        }
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};


export const getDoctorCertificatesWithPath = async (req, res) => {
    try {
        const language = 'en';
        const doctorId = req.user.doctorData.doctor_id; // Assuming doctorId is available in req.user

        const profileData = await doctorModels.getCertificationsWithUploadPathByDoctorId(doctorId);

        if (profileData && Array.isArray(profileData)) {
            profileData.forEach(certification => {
                if (certification.upload_path && !certification.upload_path.startsWith("http")) {
                    certification.upload_path = `${APP_URL}doctor/certifications/${certification.upload_path}`;
                }
            });
        }

        return handleSuccess(res, 200, language, "DOCTOR_PROFILE_RETRIEVED", profileData);
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

// ======================================chat sections==========================================================//

export const createUsersChat = async (req, res) => {
    try {
        const language = 'en';
        const doctorId = req.user.doctorData.zynq_user_id
        const { userId } = req.body;
        let chatCreatedSuccessfully = await createChat(doctorId, userId);
        if (!chatCreatedSuccessfully.insertId) {
            return handleError(res, 400, 'en', "Failed To Create a chat");
        }
        let doctorUser = { chat_id: chatCreatedSuccessfully.insertId, userId: doctorId, isActive: 1 }
        await insertChatUsersActive(doctorUser)
        let user = { chat_id: chatCreatedSuccessfully.insertId, userId: userId, isActive: 0 }
        await insertChatUsersActive(user)
        return handleSuccess(res, 200, language, 'CHAT_CREATED_SUCCESSFULLY');
    } catch (error) {
        console.error('Error in addMembersInGroup:', error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const fetchDocterAvibility = async (req, res) => {
    try {
        const language = 'en';
        const doctorId = req.user.doctorData.doctor_id;
        const listOfDocterAvibility = await doctorModels.fetchDocterAvibilityById(doctorId);
        return handleSuccess(res, 200, language, "DOCTOR_AVIBILITY_FETCH_SUCCESSFULLY", listOfDocterAvibility);
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const getDoctorProfileById = async (req, res) => {
    try {
        const language = 'en';
        const doctorId = req.query.doctor_id;
        let listOfDocterAvibility = await doctorModels.get_doctor_by_zynquser_id(doctorId);
        if (listOfDocterAvibility.length == 0) {
            return handleError(res, 400, language, "DOCTOR_FETCH_SUCCESSFULLY", {});
        }
        if (listOfDocterAvibility[0].profile_image !== null || '') {
            listOfDocterAvibility[0].profile_image = `${APP_URL}doctor/profile_images/${listOfDocterAvibility[0].profile_image}`;
        }
        return handleSuccess(res, 200, language, "DOCTOR_FETCH_SUCCESSFULLY", listOfDocterAvibility[0]);
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const isDocterOfflineOrOnline = async (req, res) => {
    try {
        const doctorId = req.user.doctorData.zynq_user_id;
        const language = 'en';
        let { isOnline } = req.body
        // const io = getIO();
        await doctorModels.update_doctor_is_online(doctorId, isOnline);
        // await toActivateUsers(isOnline, chat_id, doctorId);
        // io.to(doctorId).emit('isUsersOnlineOrOffline', isOnline);

        return handleSuccess(res, 200, language, `DOCTOR ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

    } catch (error) {
        console.error('error', error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};



// -------------------------------------slot managment------------------------------------------------//

export const createDoctorAvailability = async (req, res) => {
    try {
        const doctor_id = req.user.doctorData.doctor_id;
        const zynqUserId = req.user.id;
        const clinic_id = req.user.clinicData.clinic_id;

        const schema = Joi.object({
            slot_time: Joi.string().required(),
            same_for_all: Joi.number().valid(1, 0).optional().allow(null),
            fee_per_session: Joi.number().optional(),
            availability: Joi.array().items(
                Joi.object({
                    day_of_week: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
                    start_time: Joi.string().required().allow(''),
                    end_time: Joi.string().required().allow(''),
                    closed: Joi.number().integer().required()
                })
            ).optional(),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { slot_time, same_for_all, fee_per_session, availability } = value;

        // const { days, fee_per_session, dr_type } = req.body;
        const language = req?.user?.language || 'en';

        await dbOperations.updateData('tbl_doctors', { fee_per_session: fee_per_session, slot_time: slot_time }, `WHERE doctor_id = '${doctor_id}' `);

        if (availability?.length > 0) {
            const doctorSession = convertAvailability(availability, Number(slot_time));
            await doctorModels.updateDoctorSessionSlots(doctor_id, doctorSession, clinic_id);
            const clinic_timing = mapAvailabilityToClinicTiming(availability);
            await updateClinicOperationHours(clinic_timing, clinic_id);
        }

        await update_onboarding_status(5, zynqUserId);

        await dbOperations.updateData('tbl_clinics', { is_onboarded: 1, same_for_all: same_for_all, slot_time: slot_time }, `WHERE zynq_user_id = '${zynqUserId}' `);
        return handleSuccess(res, 200, language, 'UPDATE_DOCTOR_AVAILABILITY_SUCCESSFULLY');
    } catch (err) {
        console.error('Error creating availability:', err);
        return handleError(res, 500, 'Failed to insert availability');
    }
};


// export const updateDoctorAvailability = async (req, res) => {
//     try {
//         const doctor_id = req.user.doctorData.doctor_id;
//         const language = req?.user?.language || 'en';
//         const { days, fee_per_session, dr_type } = req.body;
//         await doctorModels.update_doctor_fee_per_session(doctor_id, fee_per_session);
//         await doctorModels.deleteDoctorAvailabilityByDoctorId(doctor_id);
//         await Promise.all(
//             days.map(dayObj => {
//                 const day = dayObj.day.toLowerCase();
//                 return Promise.all(
//                     dayObj.slots.map(async (slot) => {
//                         const availability = {
//                             doctor_id,
//                             day,
//                             start_time: slot.start_time,
//                             end_time: slot.end_time,
//                             slot_duration: slot.slot_duration,
//                             start_time_utc: slot.start_time_utc,
//                             end_time_utc: slot.end_time_utc,
//                             repeat: "weekly",
//                         };
//                         await doctorModels.insertDoctorAvailabilityModel(availability);
//                     })
//                 );
//             })
//         );
//         const zynqUserId = req.user.id
//         if (dr_type == 1) {
//             await update_onboarding_status(5, zynqUserId);
//         } else {
//             await update_onboarding_status(4, zynqUserId);
//         }
//         await dbOperations.updateData('tbl_clinics', { is_onboarded: 1 }, `WHERE zynq_user_id = '${zynqUserId}' `);
//         return handleSuccess(res, 200, language, 'UPDATE_DOCTOR_AVAILABILITY_SUCCESSFULLY');

//     } catch (err) {
//         console.error('Error updating availability:', err);
//         return handleError(res, 500, 'Failed to update availability');
//     }
// };


export const get_docter_profile = async (req, res) => {
    try {
        const language = 'en';
        const doctorId = req.user.doctorData.zynq_user_id;

        // let profileData = await get_web_user_by_id(doctorId);
        // if (profileData && profileData.profile_image && !profileData.profile_image.startsWith("http")) {
        //     profileData.profile_image = `${APP_URL}doctor/profile_images/${profileData.profile_image}`;
        // }
        let data = {
            id: doctorId,
        }
        return handleSuccess(res, 200, language, "DOCTOR_PROFILE_RETRIEVED", data);
    } catch (error) {
        console.error(error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const create_call_log_doctor = async (req, res) => {
    try {
        const {
            call_id,
            receiver_user_id,
            status,
            started_at // <-- New field from frontend
        } = req.body;

        const { role_name, doctorData } = req.user;

        const language = req?.user?.language || 'en';

        if (role_name !== 'DOCTOR') {
            return handleError(res, 403, language, "Only doctors can access this endpoint");
        }

        if (!call_id || !status || !receiver_user_id || !started_at) {
            return handleError(res, 400, language, "Missing required fields");
        }

        const sender_doctor_id = doctorData?.doctor_id;

        await doctorModels.createOrUpdateCallLog({
            call_id,
            sender_user_id: null,
            sender_doctor_id,
            receiver_user_id,
            receiver_doctor_id: null,
            status,
            started_at // Pass to model
        });

        return handleSuccess(res, 200, language, "CALL_LOG_CREATED_SUCCESSFULLY");
    } catch (error) {
        console.error("Error in create_call_log_doctor:", error);
        return handleError(res, 500, 'en', error.message);
    }
}

export const getDashboard = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'sv';
    const dashboardData = await doctorModels.getDashboardData(req.user);
    return handleSuccess(res, 200, language, 'DASHBOARD_DATA', dashboardData);
})

export const getWalletHistory = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'sv';
    const walletHistory = await doctorModels.getWalletHistoryModel(req.user);
    return handleSuccess(res, 200, language, 'WALLET_HISTORY_FETCHED', walletHistory);
})

export const getClinicPurchasedProducts = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const clinic_id = req.user.clinicData.clinic_id
    const products = await doctorModels.getClinicPurchasedProductModel(clinic_id);
    const carts = await doctorModels.getClinicCartProductModel(clinic_id);

    const {
        total_clinic_earnings,
        total_admin_earnings,
        total_carts_earnings
    } = carts.reduce(
        (acc, cart) => {
            const clinicEarning = Number(cart.clinic_earnings) || 0;
            const adminEarning = Number(cart.admin_earnings) || 0;
            const cartEarning = Number(cart.total_price) || 0;

            acc.total_clinic_earnings += clinicEarning;
            acc.total_admin_earnings += adminEarning;
            acc.total_carts_earnings += cartEarning;

            return acc;
        },
        {
            total_clinic_earnings: 0,
            total_admin_earnings: 0,
            total_carts_earnings: 0
        }
    );

    const data = {
        total_clinic_earnings: Number(total_clinic_earnings.toFixed(2)),
        total_admin_earnings: Number(total_admin_earnings.toFixed(2)),
        total_carts_earnings: Number(total_carts_earnings.toFixed(2)),
        products: products,
    }
    return handleSuccess(res, 200, language, "PURCHASED_PRODUCTS_FETCHED", data);
});

export const getSingleClinicPurchasedProducts = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const clinic_id = req.user.clinicData.clinic_id
    const purchase_id = req.params.purchase_id
    const products = await doctorModels.getSingleClinicPurchasedProductModel(clinic_id, purchase_id);
    const carts = await doctorModels.getSingleClinicCartProductModel(clinic_id, purchase_id);

    const {
        total_clinic_earnings,
        total_admin_earnings,
        total_carts_earnings
    } = carts.reduce(
        (acc, cart) => {
            const clinicEarning = Number(cart.clinic_earnings) || 0;
            const adminEarning = Number(cart.admin_earnings) || 0;
            const cartEarning = Number(cart.total_price) || 0;

            acc.total_clinic_earnings += clinicEarning;
            acc.total_admin_earnings += adminEarning;
            acc.total_carts_earnings += cartEarning;

            return acc;
        },
        {
            total_clinic_earnings: 0,
            total_admin_earnings: 0,
            total_carts_earnings: 0
        }
    );

    const data = {
        total_clinic_earnings: Number(total_clinic_earnings.toFixed(2)),
        total_admin_earnings: Number(total_admin_earnings.toFixed(2)),
        total_carts_earnings: Number(total_carts_earnings.toFixed(2)),
        products: products,
    }
    return handleSuccess(res, 200, language, "PURCHASED_PRODUCTS_FETCHED", data);
});

export const getEarnings = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const clinic_id = req?.user?.clinicData?.clinic_id
    const { user_id, role } = extractUserData(req.user)

    const promises = [
        doctorModels.getDashboardData(req.user),
        getDoctorBookedAppointmentsModel(role, user_id),
    ];

    if (clinic_id) {
        promises.push(doctorModels.getClinicPurchasedProductModel(clinic_id));
    }

    const results = await Promise.all(promises);

    // destructure safely
    const dashboardData = results[0];
    const appointments = results[1];
    const products = clinic_id ? results[2] : [];

    return handleSuccess(res, 200, language, "EARNINGS_FETCHED", {
        dashboardData,
        products,
        appointments
    });
});

export const updateDoctorAdminController = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const body = req.body;

    try {
        // 🧩 Validate request
        const schema = Joi.object({
            zynq_user_id: Joi.string().required(),

            // Personal Info
            name: Joi.string().max(255).required(),
            phone: Joi.string().max(255).required(),
            age: Joi.string().optional().allow('', null),
            address: Joi.string().max(255).required(),
            gender: Joi.string().optional().allow('', null),
            biography: Joi.string().optional().allow(''),

            // New fields
            latitude: Joi.number().optional().allow(null),
            longitude: Joi.number().optional().allow(null),
        });

        const { error, value } = schema.validate(body);
        if (error) return joiErrorHandle(res, error);

        const { zynq_user_id } = value;

        // Fetch doctor
        const [doctorData] = await doctorModels.get_doctor_by_zynquser_id(zynq_user_id);
        if (!doctorData) return handleError(res, 404, language, "DOCTOR_NOT_FOUND");

        // Prepare profile image
        let filename = doctorData.profile_image;
        if (req.file) filename = req.file.filename;

        // Update
        await doctorModels.updateDoctorAdmindetails(
            zynq_user_id,
            value.name,
            value.phone,
            value.age,
            value.address,
            value.gender,
            filename,
            value.biography,
            value.latitude ?? null,
            value.longitude ?? null
        );

        return handleSuccess(res, 200, language, "DOCTOR_PROFILE_UPDATED_SUCCESSFULLY", {});
    } catch (error) {
        console.error("updateDoctorProfile error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
});
