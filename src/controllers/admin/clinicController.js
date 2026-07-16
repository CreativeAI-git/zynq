import fs from 'fs';
import Joi from "joi";
import path from 'path';
import ejs from "ejs";
import xlsx from 'xlsx';
import bcrypt from "bcrypt";
import { generatePassword, generateToken, isEmpty } from '../../utils/user_helper.js';
import { handleError, handleSuccess, joiErrorHandle } from '../../utils/responseHandler.js';
import { insert_clinic } from '../../models/admin.js';
import * as adminModels from "../../models/admin.js";
import { fileURLToPath } from 'url';
import { sendEmail } from '../../services/send_email.js';
import moment from 'moment/moment.js';
import { calculateAndUpdateBulkClinicProfileCompletion } from '../../models/clinic.js';
import db from '../../config/db.js';
import { buildClinicData } from '../clinic/authController.js';
import * as clinicModels from "../../models/clinic.js";
import dbOperations from '../../models/common.js';
import { generateClinicsEmbeddingsV2 } from '../api/embeddingsController.js';
import { applyLanguageOverwrite } from '../../utils/misc.util.js';
import { updateDoctorClinicClaimedProfile } from '../../models/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import dotenv from 'dotenv';

dotenv.config();

const APP_URL = process.env.APP_URL;

const CLINIC_URL = process.env.CLINIC_URL;

export const import_clinics_from_CSV = async (req, res) => {
    const filePath = req.file?.path;
    if (!filePath) return handleError(res, 400, "en", "CSV_REQUIRED");

    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const clinicData = xlsx.utils.sheet_to_json(sheet);

        if (!clinicData.length) {
            fs.unlinkSync(filePath);
            return handleError(res, 400, "en", "CSV_EMPTY");
        }

        const existingRows = await db.query(
            `SELECT email, mobile_number FROM tbl_clinics`
        );

        const existingList = Array.isArray(existingRows) ? existingRows : [];

        const existingKeys = new Set(
            existingList.map(
                r => (r.email || "") + "|" + (r.mobile_number || "")
            )
        );

        const values = [];
        const seenCSV = new Set(); // dedup within CSV

        for (const row of clinicData) {
            if (!row.clinic_name || !row.email) continue; // skip invalid

            const key = (row.email || "") + "|" + (row.mobile_number || "");

            if (existingKeys.has(key) || seenCSV.has(key)) continue; // skip duplicates

            seenCSV.add(key);

            values.push([
                row.clinic_name || "",
                row.org_number || "",
                row.email || "",
                row.mobile_number || "",
                row.address || "",
                generateToken(),
                false
            ]);
        }

        if (!values.length) {
            fs.unlinkSync(filePath);
            return handleError(res, 400, "en", "NO_NEW_RECORDS");
        }

        await adminModels.insertClinics(values);

        fs.unlinkSync(filePath);
        return handleSuccess(res, 200, "en", "CLINIC_IMPORT");
    } catch (error) {
        console.error("Import failed:", error);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // cleanup even on error
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const add_clinic_managment = async (req, res) => {
    try {
        const schema = Joi.object({
            json_data: Joi.string().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const clinicList = JSON.parse(value.json_data);

        const findRole = await adminModels.findRole('CLINIC');
        if (!findRole) return handleError(res, 404, 'en', "Role 'CLINIC' not found");

        const roleId = findRole.id;
        const insertedClinics = [];
        const skippedClinics = [];

        // Parallel processing using Promise.all with map
        await Promise.all(clinicList.map(async (ele) => {
            const email = ele['Email'];

            try {
                // Check clinic name existence
                const nameExists = await adminModels.checkExistingClinicByNameModel(ele['Clinic Name']);
                if (nameExists) {
                    skippedClinics.push({ email, reason: `Clinic name '${ele['Clinic Name']}' already exists` });
                    return;
                }

                // Check email existence
                const existingUser = await adminModels.findClinicEmail(email);
                if (existingUser?.length > 0) {
                    skippedClinics.push({ email, reason: "Email already exists" });
                    return;
                }

                // Insert User
                await adminModels.addZynqUsers({ email, role_id: roleId });

                const [newUser] = await adminModels.findClinicEmail(email);
                if (!newUser) {
                    skippedClinics.push({ email, reason: "User not found after insert" });
                    return;
                }

                // Insert Clinic
                const clinicData = {
                    zynq_user_id: newUser.id,
                    clinic_name: ele['Clinic Name'],
                    org_number: ele['Swedish Organization Number'],
                    email: ele['Email'],
                    mobile_number: ele['Contact Number'],
                    address: ele['Address']
                };

                await adminModels.addClinic(clinicData);

                const [createdClinic] = await adminModels.findClinicByClinicUserId(newUser.id);
                if (!createdClinic) {
                    skippedClinics.push({ email, reason: "Clinic insert failed" });
                    return;
                }

                // Insert Clinic Location
                const clinicLocation = {
                    clinic_id: createdClinic.clinic_id,
                    city: ele['City'],
                    latitude: ele['Latitude'],
                    longitude: ele['Longitude'],
                    zip_code: ele['Postal Code']
                };
                await adminModels.addClinicLocationAddress(clinicLocation);

                insertedClinics.push({
                    email,
                    clinic_id: createdClinic.clinic_id
                });
            } catch (error) {
                skippedClinics.push({ email, reason: error.message });
            }
        }));

        // Final response logic
        if (insertedClinics.length === 0 && skippedClinics.length > 0) {
            // All failed
            return handleError(res, 409, 'en', "Email already exists", {
                inserted: insertedClinics,
                skipped: skippedClinics
            });
        }

        if (insertedClinics.length > 0 && skippedClinics.length > 0) {
            // Partial success
            return handleSuccess(res, 207, 'en', "Some clinics were imported. Some were skipped.", {
                inserted: insertedClinics,
                skipped: skippedClinics
            });
        }

        // All inserted successfully
        return handleSuccess(res, 200, 'en', "All clinics imported successfully.", {
            inserted: insertedClinics,
            skipped: skippedClinics
        });
    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const get_clinic_managment = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const search = req.query.search || "";
        const status = req.query.status || "";
        const type = req.query.type || "";
        const sortBy = req.query.sortBy || "created_at";
        const sortOrder = req.query.sortOrder || "DESC";

        // Fetch filtered clinics
        const clinics = await adminModels.get_clinic_managment(limit, offset, search, status, type, sortBy, sortOrder);

        // Total count with filters
        const totalClinics = await adminModels.get_clinics_count(search, status, type);

        if (!clinics || clinics.length === 0) {
            return handleSuccess(res, 200, 'en', "No clinics found", {
                clinics: [],
                total: 0,
                page,
                limit,
                totalPages: 0
            });
        }

        const fullClinicData = await Promise.all(
            clinics.map(async (clinic) => {

                // ✅ Logo handling (sync, cheap)
                clinic.clinic_logo = clinic.clinic_logo
                    ? `${process.env.APP_URL}clinic/logo/${clinic.clinic_logo}`
                    : null;

                // ✅ Fetch clinic images
                const images = await clinicModels.getClinicImages(clinic.clinic_id);

                const formattedImages = Array.isArray(images)
                    ? images
                        .filter(img => img?.image_url)
                        .map(img => ({
                            clinic_image_id: img.clinic_image_id,
                            url: img.image_url.startsWith("http")
                                ? img.image_url
                                : `${APP_URL}clinic/files/${img.image_url}`,
                        }))
                    : [];
                // skinConditionsLevel: await adminModels.get_clinic_skin_conditions(clinic.clinic_id),

                // ✅ Fetch clinic location (default to empty object)
                const [clinicLocation = {}] = await clinicModels.getClinicLocation(clinic.clinic_id);

                // ✅ Run ALL remaining queries in parallel
                const [
                    treatments,
                    skinTypes,
                    severityLevels,
                    surgeriesLevel,
                    aestheticDevicesLevel,
                    operationHours
                ] = await Promise.all([
                    clinicModels.getClinicMappedTreatments(clinic.clinic_id),
                    adminModels.get_clinic_skintype(clinic.clinic_id),
                    adminModels.get_clinic_serveritylevel(clinic.clinic_id),
                    adminModels.get_clinic_surgeries(clinic.clinic_id),
                    clinicModels.getClinicAestheticDevicesLevel(clinic.clinic_id),
                    clinicModels.getClinicOperationHours(clinic.clinic_id)
                ]);

                if (clinic.user_type == "Solo Doctor") {
                    clinic.new_user_type = "Solo Expert";
                } else {
                    clinic.new_user_type = "Clinic";
                }

                return {
                    ...clinic,
                    treatments,
                    skinTypes,
                    severityLevels,
                    surgeriesLevel,
                    aestheticDevicesLevel,
                    operationHours,
                    images: formattedImages,
                    clinicLocation

                };
            })
        );


        await calculateAndUpdateBulkClinicProfileCompletion(fullClinicData);

        return handleSuccess(res, 200, 'en', "Fetch clinic management successfully", {
            clinics: fullClinicData,
            total: totalClinics,
            page,
            limit,
            totalPages: Math.ceil(totalClinics / limit)
        });

    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const getClinicListForDoctorOnboardingController = async (req, res) => {
    try {
        const status = req.query.status || "";
        const language = req?.user?.language || 'en';

        // Fetch filtered clinics
        const clinics = await adminModels.getClinicListForDoctorOnboardingModel(status);

        return handleSuccess(res, 200, language, "Fetch clinic management successfully", clinics);

    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};


export const delete_clinic_management = async (req, res) => {
    try {
        const schema = Joi.object({
            clinic_id: Joi.string().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { clinic_id } = value;

        const dependencies = await adminModels.checkClinicDependencies(clinic_id);
        if (dependencies.doctors > 0 || dependencies.appointments > 0) {
            return handleError(res, 400, 'en', `Cannot delete clinic. It has ${dependencies.doctors} active doctor mappings and ${dependencies.appointments} active/upcoming appointments.`);
        }

        const result = await adminModels.delete_clinic_by_id(clinic_id);

        if (result && result.affectedRows === 0) {
            return handleSuccess(res, 404, 'en', "Clinic not found or already deleted", {});
        }

        return handleSuccess(res, 200, 'en', "Clinic deleted successfully", result);
    } catch (error) {
        console.error("Delete Clinic Error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const send_invitation = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';
        const schema = Joi.object({
            invitation_ids: Joi.string().required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let invitation_ids;
        try {
            const cleanJson = value.invitation_ids.replace(/'/g, '"');
            invitation_ids = JSON.parse(cleanJson);
        } catch (err) {
            console.error('Invalid JSON format in invitation_ids:', err.message);
            return handleError(res, 400, 'en', 'Invalid format for invitation_ids');
        }

        const clinics = await adminModels.findClinicById(invitation_ids);
        if (!clinics || clinics.length === 0) {
            return handleError(res, 404, 'en', 'No clinics found');
        }

        await Promise.all(clinics.map(async (clinic) => {
            const password = await generatePassword(clinic.email);
            const hashedPassword = await bcrypt.hash(password, 10);

            await adminModels.updatePasseordByClinicId(
                hashedPassword,
                password,
                clinic.zynq_user_id
            );

            const updatedEmailCount = (clinic.email_sent_count || 0) + 1;

            await adminModels.updateClinicCountAndEmailSent(
                clinic.clinic_id,
                updatedEmailCount,
                moment().format('YYYY-MM-DD HH:mm:ss')
            );
            const is_subscribed = clinic.clinic_id;

            const html = await ejs.renderFile(
                path.join(__dirname, "../../views/invitation-mail.ejs"),
                {
                    clinic_name: clinic.clinic_name,
                    organization_number: clinic.org_number,
                    email: clinic.email,
                    phone: clinic.mobile_number,
                    city: clinic.city,
                    postal_code: clinic.zip_code,
                    address: clinic.address,
                    password: password,
                    logo: process.env.LOGO_URL_PNG,
                    invitationLink: `${process.env.APP_URL}admin/subscribed/${is_subscribed}`,
                }
            );

            await sendEmail({
                to: clinic.email,
                subject: "You're One Step Away from Joining ZYNQ – Accept Your Invite",
                html,
            });
        }));

        return handleSuccess(res, 200, language, "INVITATION_SENT_SUCCESSFULLY");

    } catch (error) {
        console.error("Send Invitation Error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

async function onboardingByRole(id, role_id) {
    try {


        /** Update claimed profile */
        await updateDoctorClinicClaimedProfile(id, role_id);

        /** Get user */
        const zynqUser = await dbOperations.getData(
            "tbl_zqnq_users",
            `WHERE id = '${id}'`
        );

        if (!zynqUser.length) {
            throw new Error("USER_NOT_FOUND");
        }

        /** Update role */
        await dbOperations.updateData(
            "tbl_zqnq_users",
            { role_id, role_selected: 1 },
            `WHERE id = '${id}'`
        );

        /** Doctor role logic */
        const DOCTOR_ROLE_ID = "407595e3-3196-11f0-9e07-0e8e5d906eef";

        if (role_id === DOCTOR_ROLE_ID) {
            /** Insert doctor if not exists */

            const [doctor] = await dbOperations.getSelectedColumn(
                "doctor_id",
                "tbl_doctors",
                `WHERE zynq_user_id='${id}'`
            );

            const [clinic] = await dbOperations.getSelectedColumn(
                "clinic_id",
                "tbl_clinics",
                `WHERE zynq_user_id='${id}'`
            );

            if (doctor && clinic) {
                await dbOperations.updateData("tbl_doctor_clinic_map", {
                    is_invitation_accepted: 1,
                }, `WHERE doctor_id = '${doctor.doctor_id}' AND clinic_id = '${clinic.clinic_id}'`);
            }
        }

        return {
            success: true,
            message: "ENROLL_SUCCESSFUL",
        };
    } catch (error) {
        console.error("Onboarding By Role Service Error:", error.message);
        throw error; // let controller handle response
    }
}

export const subscribed = async (req, res) => {
    try {
        const schema = Joi.object({
            is_subscribed: Joi.string().required()
        });


        const { error, value } = schema.validate(req.params);
        if (error) return joiErrorHandle(res, error);

        const { is_subscribed } = value;

        const gwetClinic = await adminModels.clinicSubscribed(is_subscribed);

        const [getRole] = await adminModels.getZynqUserLanguageModel(gwetClinic[0].zynq_user_id);

        const data = await onboardingByRole(gwetClinic[0].zynq_user_id, getRole.role_id);

        return res.redirect(`${CLINIC_URL}`);
    } catch (error) {
        console.error("clinic unsubscribed Error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const unsubscribed = async (req, res) => {
    try {
        const schema = Joi.object({
            is_unsubscribed: Joi.string().required()
        });

        const { error, value } = schema.validate(req.params);
        if (error) return joiErrorHandle(res, error);

        const { is_unsubscribed } = value;

        await adminModels.clinicUnsubscribed(is_unsubscribed);

        res.render("invitation_failed/failed.ejs");
    } catch (error) {
        console.error("clinic unsubscribed Error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};


const daySchema = Joi.object({
    open: Joi.string().allow("").optional().allow("", null),
    close: Joi.string().allow("").optional().allow("", null),
    is_closed: Joi.boolean().optional().allow("", null),
});

export const add_clinic_with_onboarding = async (req, res) => {
    try {
        const schema = Joi.object({
            clinic_name: Joi.string().optional().allow("", null),
            org_number: Joi.string().optional().allow("", null),
            email: Joi.string().email().required(),
            slot_time: Joi.string().optional().allow("", null),
            same_for_all: Joi.string().valid("1", "0").optional().allow("", null),
            mobile_number: Joi.string().optional().allow("", null),
            address: Joi.string().optional().allow("", null),
            city: Joi.string().optional().allow("", null),
            postal_code: Joi.string().optional().allow("", null),
            latitude: Joi.string().optional().allow("", null),
            longitude: Joi.string().optional().allow("", null),
            clinic_description: Joi.string().optional().allow("", null),
            language: Joi.string().valid("en", "sv").optional().allow("", null),
            street_address: Joi.string().optional().allow("", null),
            state: Joi.string().optional().allow("", null),
            website_url: Joi.string().optional().allow("", null),
            fee_range: Joi.string().optional().allow("", null),
            treatments: Joi.array()
                .items(
                    Joi.object({
                        treatment_id: Joi.string().uuid().required(),
                        total_price: Joi.number().precision(2).required(),

                        sub_treatments: Joi.array()
                            .items(
                                Joi.object({
                                    sub_treatment_id: Joi.string().uuid().required(),
                                    price: Joi.number().precision(2).required(),
                                })
                            )
                            .optional()
                            .allow(null)
                    })
                )
                .optional()
                .allow(null),
            clinic_timing: Joi.object({
                monday: daySchema.optional().allow("", null),
                tuesday: daySchema.optional().allow("", null),
                wednesday: daySchema.optional().allow("", null),
                thursday: daySchema.optional().allow("", null),
                friday: daySchema.optional().allow("", null),
                saturday: daySchema.optional().allow("", null),
                sunday: daySchema.optional().allow("", null),
            }).optional(),
            equipments: Joi.array().items(Joi.string()).optional().allow('', null),
            skin_types: Joi.array().items(Joi.string()).optional().allow("", null),
            severity_levels: Joi.array()
                .items(Joi.string())
                .optional()
                .allow("", null),
            form_stage: Joi.number().optional().allow("", null),
            ivo_registration_number: Joi.string().optional().allow("", null),
            hsa_id: Joi.string().optional().allow("", null),
            is_onboarded: Joi.boolean().optional().allow("", null),
            surgeries: Joi.array().items(Joi.string()).optional().allow("", null),
            aestheticDevices: Joi.array()
                .items(Joi.string())
                .optional()
                .allow("", null),
            skin_Conditions: Joi.array()
                .items(Joi.string())
                .optional()
                .allow("", null),
        });

        if (typeof req.body.clinic_timing === "string") {
            try {
                req.body.clinic_timing = JSON.parse(req.body.clinic_timing);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_CLINIC_TIMING");
            }
        }

        if (typeof req.body.treatments === "string") {
            try {
                req.body.treatments = JSON.parse(req.body.treatments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_TREATMENTS");
            }
        }

        if (typeof req.body.surgeries === "string") {
            try {
                req.body.surgeries = JSON.parse(req.body.surgeries);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SURGERIES");
            }
        }

        if (typeof req.body.skin_Conditions === "string") {
            try {
                req.body.skin_Conditions = JSON.parse(req.body.skin_Conditions);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKIN_CONDITIONS");
            }
        }

        if (typeof req.body.aestheticDevices === "string") {
            try {
                req.body.aestheticDevices = JSON.parse(req.body.aestheticDevices);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_ASTHETIC_DEVICES");
            }
        }

        if (typeof req.body.equipments === "string") {
            try {
                req.body.equipments = JSON.parse(req.body.equipments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EQUIPMENTS");
            }
        }

        if (typeof req.body.skin_types === "string") {
            try {
                req.body.skin_types = JSON.parse(req.body.skin_types);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKIN_TYPES");
            }
        }

        if (typeof req.body.severity_levels === "string") {
            try {
                req.body.severity_levels = JSON.parse(req.body.severity_levels);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SEVERITY_LEVELS");
            }
        }

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let {
            clinic_name,
            org_number,
            email,
            mobile_number,
            address,
            city,
            postal_code,
            latitude,
            longitude,
            street_address,
            state,
            treatments,
            clinic_timing,
            website_url,
            clinic_description,
            equipments,
            skin_types,
            severity_levels,
            fee_range,
            language,
            form_stage,
            ivo_registration_number,
            hsa_id,
            is_onboarded,
            surgeries,
            aestheticDevices,
            skin_Conditions,
            slot_time,
            same_for_all
        } = value;


        // Find CLINIC role
        const findRole = await adminModels.findRole('CLINIC');
        if (!findRole) return handleError(res, 404, 'en', "Role 'CLINIC' not found");

        const roleId = findRole.id;

        if (clinic_name) {
            const nameExists = await adminModels.checkExistingClinicByNameModel(clinic_name);
            if (nameExists) {
                return handleError(res, 400, 'en', "Clinic name already exists", { clinic_name });
            }
        }

        // Check if email already exists
        const existingUser = await adminModels.findClinicEmail(email);
        if (existingUser?.length > 0) {
            return handleError(res, 400, 'en', "Email already exists", {
                email: email
            });
        }

        try {
            // Insert User
            await adminModels.addZynqUsers({ email, role_id: roleId });

            const [newUser] = await adminModels.findClinicEmail(email);

            let zynq_user_id = newUser.id;

            language = language || "en";

            const uploadedFiles = req.files;

            const clinic_logo = Array.isArray(uploadedFiles)
                ? uploadedFiles.find(file => file.fieldname === "logo")?.filename
                : null;


            const [clinic_data] = await clinicModels.get_clinic_by_zynq_user_id(zynq_user_id);

            const clinicData = {
                zynq_user_id:
                    zynq_user_id === "" ? null : zynq_user_id || clinic_data.zynq_user_id,
                clinic_name:
                    clinic_name === "" ? null : clinic_name || clinic_data.clinic_name,
                org_number:
                    org_number === "" ? null : org_number || clinic_data.org_number,
                email: email === "" ? null : email || clinic_data?.email || null,
                // email: email === "" ? null : email || clinic_data.email,
                mobile_number:
                    mobile_number === ""
                        ? null
                        : mobile_number || clinic_data.mobile_number,
                address: address === "" ? null : address || (clinic_data ? clinic_data.address : null),
                fee_range: fee_range === "" ? null : fee_range || (clinic_data ? clinic_data.fee_range : null),
                website_url: website_url === "" ? null : website_url || (clinic_data ? clinic_data.website_url : null),
                clinic_description: clinic_description === "" ? null : clinic_description || (clinic_data ? clinic_data.clinic_description : null),
                language: language === "" ? null : language || (clinic_data ? clinic_data.language : null),
                clinic_logo: clinic_logo === "" ? null : clinic_logo || (clinic_data ? clinic_data.clinic_logo : null),
                form_stage: form_stage === "" ? null : form_stage || (clinic_data ? clinic_data.form_stage : null),
                ivo_registration_number: ivo_registration_number === "" ? null : ivo_registration_number || (clinic_data ? clinic_data.ivo_registration_number : null),
                hsa_id: hsa_id === "" ? null : hsa_id || (clinic_data ? clinic_data.hsa_id : null),
                is_onboarded: is_onboarded === "" ? 0 : is_onboarded || (clinic_data ? clinic_data.is_onboarded : 0),
                city: city === "" ? null : city || (clinic_data ? clinic_data.city : null),
                state: state === "" ? null : state || (clinic_data ? clinic_data.state : null),

            };


            let profile_status = "ONBOARDING";

            if (!isEmpty(form_stage)) {
                clinicData.profile_status = profile_status;
            }

            const clinicDataV2 = buildClinicData(clinicData);

            delete clinicDataV2.city;
            delete clinicDataV2.state;

            clinicDataV2.slot_time = slot_time;
            clinicDataV2.same_for_all = same_for_all || 0;


            if (clinic_data) {
                await clinicModels.updateClinicData(clinicDataV2, clinic_data.clinic_id);
            } else {
                await clinicModels.insertClinicData(clinicDataV2);
            }

            const [clinic] = await clinicModels.get_clinic_by_zynq_user_id(zynq_user_id);
            const clinic_id = clinic.clinic_id;
            const clinicImageFiles = [];

            if (uploadedFiles?.length > 0) {
                for (const file of uploadedFiles) {
                    const fileName = file.filename;

                    if (file.fieldname === "files") {
                        clinicImageFiles.push(fileName);
                        continue;
                    }

                    const [certificationType] =
                        await clinicModels.getCertificateTypeByFileName(file.fieldname);
                    const certification_type_id =
                        certificationType?.certification_type_id || null;

                    if (certification_type_id) {
                        await clinicModels.insertClinicDocuments(
                            clinic_id,
                            certification_type_id,
                            file.fieldname,
                            fileName
                        );
                    }
                }

                if (clinicImageFiles.length > 0) {
                    await clinicModels.insertClinicImages(clinic_id, clinicImageFiles);
                }
            }

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
                    zip_code: postal_code === "" ? null : postal_code || clinicLocation.zip_code,
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
                    zip_code: postal_code,
                    latitude: latitude,
                    longitude: longitude,
                };
                await clinicModels.insertClinicLocation(insert_data);
            }

            if (Array.isArray(treatments) && treatments.length > 0) {
                const treatmentsData = await clinicModels.createClinicMappedTreatments(clinic_id, treatments);
            }

            if (surgeries) {
                const surgeriesData = await clinicModels.getClinicSurgeries(clinic_id);
                if (surgeriesData && surgeriesData.length > 0) {
                    await clinicModels.updateClinicSurgeries(surgeries, clinic_id);
                } else {
                    await clinicModels.insertClinicSurgeries(surgeries, clinic_id);
                }
            }

            if (skin_Conditions) {
                const skinConditionData = await clinicModels.getClinicSkinConditions(
                    clinic_id
                );
                if (skinConditionData && skinConditionData.length > 0) {
                    await clinicModels.updateClinicSkinConditions(
                        skin_Conditions,
                        clinic_id
                    );
                } else {
                    await clinicModels.insertClinicSkinConditions(
                        skin_Conditions,
                        clinic_id
                    );
                }
            }

            if (aestheticDevices) {
                const devicesData = await clinicModels.getClinicAestheticDevices(
                    clinic_id
                );
                if (devicesData && devicesData.length > 0) {
                    await clinicModels.updateClinicAestheticDevices(
                        aestheticDevices,
                        clinic_id
                    );
                } else {
                    await clinicModels.insertClinicAestheticDevices(
                        aestheticDevices,
                        clinic_id
                    );
                }
            }

            if (clinic_timing) {
                const clinicTimingData = await clinicModels.getClinicOperationHours(
                    clinic_id
                );
                if (clinicTimingData) {
                    if (!clinic_timing) {
                        return;
                    }
                    await clinicModels.updateClinicOperationHours(clinic_timing, clinic_id);
                } else {
                    if (!clinic_timing) {
                        return;
                    }
                    await clinicModels.insertClinicOperationHours(clinic_timing, clinic_id);
                }
            }

            if (equipments) {
                const equipmentsData = await clinicModels.getClinicEquipments(clinic_id);
                if (equipmentsData) {
                    await clinicModels.updateClinicEquipments(equipments, clinic_id);
                } else {
                    await clinicModels.insertClinicEquipments(equipments, clinic_id);
                }
            }

            if (skin_types) {
                const skinTypesData = await clinicModels.getClinicSkinTypes(clinic_id);
                if (skinTypesData) {
                    await clinicModels.updateClinicSkinTypes(skin_types, clinic_id);
                } else {
                    await clinicModels.insertClinicSkinTypes(skin_types, clinic_id);
                }
            }

            if (severity_levels) {
                const severityLevelsData = await clinicModels.getClinicSeverityLevels(
                    clinic_id
                );
                if (severityLevelsData) {
                    await clinicModels.updateClinicSeverityLevels(
                        severity_levels,
                        clinic_id
                    );
                } else {
                    await clinicModels.insertClinicSeverityLevels(
                        severity_levels,
                        clinic_id
                    );
                }
            }

            // Return success response
            return handleSuccess(res, 200, language, "CLINIC_CREATED_SUCCESSFULLY", {
                email: email,
                clinic_name: clinic_name
            });


        } catch (error) {
            console.error("Database error:", error);
            return handleError(res, 500, 'en', "Clinic creation failed: " + error.message);
        }

    } catch (error) {
        console.error("Internal error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const get_Clinic_Mapped_treatments = async (req, res) => {
    try {
        const { clinic_id } = req.params;
        const { language } = req.user;
        const treatments = await clinicModels.getClinicMappedTreatments(clinic_id);
        return handleSuccess(res, 200, language, "TREATMENTS_FETCHED_SUCCESSFULLY", applyLanguageOverwrite(treatments, language));
    } catch (error) {
        console.error("Error fetching treatments:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const getAllSurgeryOfClinicController = async (req, res) => {
    try {
        const language = req?.user?.language || "en";
        const { clinic_id } = req.params;
        const surgery = await clinicModels.getAllSurgeriesOfClinic(language, clinic_id);
        if (!surgery.length) {
            return handleError(res, 400, language, "NO_SURGERY_FOUND");
        }
        return handleSuccess(
            res,
            200,
            language,
            "SURGERY_FETCHED_SUCCESSFULLY",
            surgery
        );
    } catch (error) {
        console.error("Error in getAllSurgery:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const getAllDevicesOfClinicController = async (req, res) => {
    try {
        const language = "en";
        const { clinic_id } = req.params;
        const { treatment_ids } = req.query;
        console.log({ treatment_ids, clinic_id });
        if (treatment_ids) {
            const ids = treatment_ids ? treatment_ids.split(',') : [];
            const devices = await clinicModels.getAllDevicesOfClinic(clinic_id, ids);
            if (!devices.length) {
                return handleError(res, 400, language, "NO_DEVICES_FOUND");
            }
            return handleSuccess(
                res,
                200,
                language,
                "DEVICES_FETCHED_SUCCESSFULLY",
                devices
            );
        } else {
            let devices = []
            return handleSuccess(
                res,
                200,
                language,
                "DEVICES_NOT_FOUND",
                devices
            );
        }
    } catch (error) {
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const getClinicSkinTypesOfClinicController = async (req, res) => {
    try {
        const language = req.user.language || "en";
        const { clinic_id } = req.params;
        const skinTypes = await clinicModels.getAllSkinTypesOfClinic(language, clinic_id);
        if (!skinTypes.length) {
            return handleError(res, 404, language, "NO_SKIN_TYPES_FOUND");
        }
        return handleSuccess(
            res,
            200,
            language,
            "SKIN_TYPES_FETCHED_SUCCESSFULLY",
            skinTypes
        );
    } catch (error) {
        console.error("Error in getClinicSkinTypes:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const updateClinicController = async (req, res) => {
    try {
        const schema = Joi.object({
            zynq_user_id: Joi.string().uuid().required(),
            clinic_name: Joi.string().optional().allow(null),
            org_number: Joi.string().optional().allow(null),
            email: Joi.string().email().optional().allow(null),
            mobile_number: Joi.string().optional().allow(null),
            address: Joi.string().optional().allow(null),
            fee_range: Joi.string().optional().allow(null),
            website_url: Joi.string().allow(null).optional(),
            clinic_description: Joi.string().allow(null).optional(),
            street_address: Joi.string().optional().allow(null),
            city: Joi.string().optional().allow(null),
            state: Joi.string().optional().allow(null),
            zip_code: Joi.string().optional().allow(null),
            latitude: Joi.number().optional().allow(null),
            longitude: Joi.number().optional().allow(null),
            treatments: Joi.array()
                .items(
                    Joi.object({
                        treatment_id: Joi.string().uuid().required(),
                        total_price: Joi.number().precision(2).required(),
                        name: Joi.string().optional().allow(null),
                        swedish: Joi.string().optional().allow(null),
                        clinic_treatment_id: Joi.string().optional().allow(null),

                        sub_treatments: Joi.array()
                            .items(
                                Joi.object({
                                    sub_treatment_id: Joi.string().uuid().required(),
                                    price: Joi.number().precision(2).required(),
                                    name: Joi.string().optional().allow(null),
                                    swedish: Joi.string().optional().allow(null),
                                    clinic_sub_treatment_id: Joi.string().optional().allow(null),
                                })
                            )
                            .optional()
                            .allow(null)
                    })
                )
                .optional()
                .allow(null),
            clinic_timing: Joi.object({
                monday: daySchema.optional().allow("", null),
                tuesday: daySchema.optional().allow("", null),
                wednesday: daySchema.optional().allow("", null),
                thursday: daySchema.optional().allow("", null),
                friday: daySchema.optional().allow("", null),
                saturday: daySchema.optional().allow("", null),
                sunday: daySchema.optional().allow("", null),
            }).optional(),
            equipments: Joi.array().items(Joi.string()).optional().allow(null),
            skin_types: Joi.array().items(Joi.string()).optional().allow(null),
            skin_Conditions: Joi.array().items(Joi.string()).optional().allow(null),
            surgeries: Joi.array().items(Joi.string()).optional().allow(null),
            aestheticDevices: Joi.array().items(Joi.string()).optional().allow(null),
            severity_levels: Joi.array().items(Joi.string()).optional().allow(null),
            language: Joi.string().valid("en", "sv").optional().allow(null),
            ivo_registration_number: Joi.string().optional().allow(null),
            hsa_id: Joi.string().optional().allow(null),
            slot_time: Joi.string().optional().allow(null),
            removed_file_ids: Joi.array().items(Joi.string()).optional().allow(null),
            same_for_all: Joi.string().valid("1", "0").optional().allow(null),
        });


        if (typeof req.body.clinic_timing === "string") {
            try {
                req.body.clinic_timing = JSON.parse(req.body.clinic_timing);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_CLINIC_TIMING");
            }
        }

        if (typeof req.body.removed_file_ids === "string") {
            try {
                req.body.removed_file_ids = JSON.parse(req.body.removed_file_ids);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_REMOVED_IDS");
            }
        }

        if (typeof req.body.treatments === "string") {
            try {
                req.body.treatments = JSON.parse(req.body.treatments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_TREATMENTS");
            }
        }

        if (typeof req.body.surgeries === "string") {
            try {
                req.body.surgeries = JSON.parse(req.body.surgeries);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SURGERIES");
            }
        }

        if (typeof req.body.skin_Conditions === "string") {
            try {
                req.body.skin_Conditions = JSON.parse(req.body.skin_Conditions);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKIN_CONDITIONS");
            }
        }

        if (typeof req.body.aestheticDevices === "string") {
            try {
                req.body.aestheticDevices = JSON.parse(req.body.aestheticDevices);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_ASTHETIC_DEVICES");
            }
        }

        if (typeof req.body.equipments === "string") {
            try {
                req.body.equipments = JSON.parse(req.body.equipments);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_EQUIPMENTS");
            }
        }

        if (typeof req.body.skin_types === "string") {
            try {
                req.body.skin_types = JSON.parse(req.body.skin_types);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SKIN_TYPES");
            }
        }

        if (typeof req.body.severity_levels === "string") {
            try {
                req.body.severity_levels = JSON.parse(req.body.severity_levels);
            } catch (err) {
                return handleError(res, 400, "en", "INVALID_JSON_FOR_SEVERITY_LEVELS");
            }
        }

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const {
            clinic_name,
            org_number,
            email,
            mobile_number,
            address,
            fee_range,
            website_url,
            clinic_description,
            street_address,
            city,
            state,
            zip_code,
            latitude,
            longitude,
            treatments,
            clinic_timing,
            equipments,
            skin_types,
            severity_levels,
            language,
            ivo_registration_number,
            hsa_id,
            skin_Conditions,
            surgeries,
            aestheticDevices,
            zynq_user_id,
            removed_file_ids,
            same_for_all,
            slot_time
        } = value;

        if (clinic_name) {
            const nameExists = await adminModels.checkExistingClinicByNameModel(clinic_name, zynq_user_id);
            if (nameExists) {
                return handleError(res, 400, 'en', "Clinic name already exists", { clinic_name });
            }
        }

        const uploadedFiles = req.files;

        const clinic_logo = Array.isArray(uploadedFiles)
            ? uploadedFiles.find(file => file.fieldname === "logo")?.filename
            : null;


        const [clinic] = await clinicModels.get_clinic_by_zynq_user_id(
            zynq_user_id
        );
        if (!clinic) {
            return handleError(res, 404, language, "CLINIC_NOT_FOUND");
        }

        const clinic_id = clinic.clinic_id;

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

        // await clinicModels.updateClinicLocation({
        //     clinic_id,
        //     street_address: street_address ? street_address : clinicLocation.street_address,
        //     city: city ? city : clinicLocation.city,
        //     state: state ? state : clinicLocation.state,
        //     zip_code: zip_code ? zip_code : clinicLocation.zip_code,
        //     latitude: latitude ? latitude : clinicLocation.latitude,
        //     longitude: longitude ? longitude : clinicLocation.longitude,
        // });

        await clinicModels.updateClinicLocation({
            clinic_id,
            street_address: street_address ?? clinicLocation.street_address ?? null,
            city: city ?? clinicLocation.city ?? null,
            state: state ?? clinicLocation.state ?? null,
            zip_code: zip_code ?? clinicLocation.zip_code ?? null,
            latitude: latitude ?? clinicLocation.latitude ?? null,
            longitude: longitude ?? clinicLocation.longitude ?? null,
        },clinic_id);


        const updatePromises = [];

        if (Array.isArray(treatments) && treatments.length > 0) {
            updatePromises.push(
                clinicModels.updateClinicMappedTreatments(clinic_id, treatments)
            );
        }

        if (
            clinic_timing &&
            typeof clinic_timing === "object" &&
            Object.keys(clinic_timing).length > 0
        ) {
            updatePromises.push(
                clinicModels.updateClinicOperationHours(clinic_timing, clinic_id)
            );
        }

        if (Array.isArray(equipments) && equipments.length > 0) {
            updatePromises.push(
                clinicModels.updateClinicEquipments(equipments, clinic_id)
            );
        }

        if (Array.isArray(skin_types) && skin_types.length > 0) {
            updatePromises.push(
                clinicModels.updateClinicSkinTypes(skin_types, clinic_id)
            );
        }

        if (Array.isArray(severity_levels) && severity_levels.length > 0) {
            updatePromises.push(
                clinicModels.updateClinicSeverityLevels(severity_levels, clinic_id)
            );
        }

        if (Array.isArray(skin_Conditions) && skin_Conditions.length > 0) {
            updatePromises.push(
                clinicModels.updateClinicSkinConditionsLevel(skin_Conditions, clinic_id)
            );
        }

        if (Array.isArray(surgeries) && surgeries.length > 0) {
            updatePromises.push(
                clinicModels.updateClinicSurgeriesLevel(surgeries, clinic_id)
            );
        }

        if (Array.isArray(removed_file_ids) && removed_file_ids.length > 0) {
            updatePromises.push(
                clinicModels.deleteClinicImageModel(removed_file_ids)
            );
        }

        if (Array.isArray(aestheticDevices) && aestheticDevices.length > 0) {
            updatePromises.push(
                clinicModels.updateClinicAestheticDevicesLevel(
                    aestheticDevices,
                    clinic_id
                )
            );
        }

        await Promise.all(updatePromises);

        let clinicImageFiles = [];

        if (uploadedFiles?.length > 0) {
            for (const file of uploadedFiles) {
                const fileName = file.filename;

                if (file.fieldname === "files") {
                    clinicImageFiles.push(fileName);
                    continue;
                }

                const [certificationType] =
                    await clinicModels.getCertificateTypeByFileName(file.fieldname);
                const certification_type_id =
                    certificationType?.certification_type_id || null;

                if (certification_type_id) {
                    await clinicModels.insertClinicDocuments(
                        clinic_id,
                        certification_type_id,
                        file.fieldname,
                        fileName
                    );
                }
            }

            if (clinicImageFiles.length > 0) {
                await clinicModels.insertClinicImages(clinic_id, clinicImageFiles);
            }
        }
        await generateClinicsEmbeddingsV2(zynq_user_id);
        return handleSuccess(
            res,
            200,
            language,
            "CLINIC_PROFILE_UPDATED_SUCCESSFULLY"
        );
    } catch (error) {
        console.error("Error in updateClinic:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};