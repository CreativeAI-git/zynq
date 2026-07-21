import Joi from "joi";
import ejs from 'ejs';
import path from "path";
import crypto from "crypto";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import jwt from "jsonwebtoken"
import * as webModels from "../../models/web_user.js";
import * as clinicModels from "../../models/clinic.js";
import { asyncHandler, handleError, handleSuccess, joiErrorHandle } from "../../utils/responseHandler.js";
import { fileURLToPath } from "url";
import { sendEmail } from "../../services/send_email.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const APP_URL = process.env.APP_URL;
const image_logo = process.env.LOGO_URL;
const WEB_JWT_SECRET = process.env.WEB_JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY;
import dbOperations from '../../models/common.js';
import { get_doctor_by_zynq_user_id } from "../../models/doctor.js";
import { updateDoctorClinicClaimedProfile } from "../../models/api.js";

export const login_web_user = async (req, res) => {
    try {
        const schema = Joi.object({
            email: Joi.string().min(5).max(255).email({ tlds: { allow: false } }).lowercase().required(),
            password: Joi.string().min(8).max(15).required(),
            fcm_token: Joi.string().optional().allow("", null),
            language: Joi.string().valid('en', 'sv').required()
        });

        // let language = 'en';

        const { error, value } = schema.validate(req.body);

        if (error) return joiErrorHandle(res, error);

        const { email, password, fcm_token, language } = value;

        // const roleSelectedStatus = await dbOperations.getSelectedColumn('role_selected, role_id', 'tbl_zqnq_users', `WHERE email = '${email}'`); (email);
        // if (roleSelectedStatus.length > 0) {
        //     if (roleSelectedStatus[0].role_selected === 0 && roleSelectedStatus[0].role_id !== "3677a3e6-3196-11f0-9e07-0e8e5d906eef") {
        //         return handleError(res, 400, language, "ROLE_TYPE_NOT_SELECTED");
        //     }
        // }

        const [existingWebUser] = await webModels.get_web_user_by_email(email);
        if (!existingWebUser) {
            return handleError(res, 400, language, "CLINIC_NOT_FOUND");
        }
        // language = existingWebUser.language;

        const isPasswordValid = await bcrypt.compare(password, existingWebUser.password || "");
        if (!isPasswordValid) {
            return handleError(res, 400, language, "INVALID_EMAIL_PASSWORD");
        }

        const token = jwt.sign({ web_user_id: existingWebUser.id, fcm_token: fcm_token, email: existingWebUser.email, role: existingWebUser.role_name }, WEB_JWT_SECRET, {
            expiresIn: JWT_EXPIRY
        });

        await webModels.update_jwt_fcm_token(token, fcm_token, existingWebUser.id, language);
        const [user_data] = await webModels.get_web_user_by_id(existingWebUser.id);
        const [get_clinic] = await clinicModels.get_clinic_by_zynq_user_id(existingWebUser.id);
        const [get_doctor] = await get_doctor_by_zynq_user_id(existingWebUser.id);

        if (existingWebUser.role_name === 'CLINIC' && (!get_clinic || get_clinic.is_deleted === 1)) {
            return handleError(res, 400, language, "CLINIC_DELETED");
        }

        if (existingWebUser.role_name === 'DOCTOR') {
            if (!get_doctor || get_doctor.is_deleted === 1) {
                return handleError(res, 400, language, "DOCTOR_DELETED");
            }
            if (get_doctor.is_active === 0) {
                return handleError(res, 400, language, "DOCTOR_DEACTIVATED");
            }
        }

        if (existingWebUser.role_name === 'SOLO_DOCTOR') {
            if (!get_clinic || get_clinic.is_deleted === 1 || !get_doctor || get_doctor.is_deleted === 1) {
                return handleError(res, 400, language, "USER_DELETED");
            }
            if (get_doctor.is_active === 0) {
                return handleError(res, 400, language, "DOCTOR_DEACTIVATED");
            }
        }

        if (get_clinic) {
            const form_stage = get_clinic.form_stage;
            user_data.form_stage = form_stage;
            user_data.is_onboarded = get_clinic.is_onboarded;
            user_data.clinic_name = get_clinic.clinic_name;
        }

        if (get_doctor) {
            user_data.doctor_name = get_doctor.name;
        }

        return handleSuccess(res, 200, language, "LOGIN_SUCCESSFUL", user_data);
    } catch (error) {
        console.error(error);
        return handleError(res, 500, error.message);
    }
};

export const forgot_password = async (req, res) => {
    try {
        const schema = Joi.object({
            email: Joi.string().email().required(),
            language: Joi.string().valid('en', 'sv').required()
        });

        // let language = 'en';

        const { error, value } = schema.validate(req.body);
        if (error) {
            return joiErrorHandle(res, error);
        }

        const { email, language } = value;

        const [webUser] = await webModels.get_web_user_by_email(email);
        if (!webUser) {
            return handleError(res, 404, language, "USER_NOT_FOUND");
        }

        // language = webUser.language;

        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

        await webModels.update_reset_token(resetToken, resetTokenExpiry, email, language);

        const resetLink = `${APP_URL}webuser/reset-password?token=${resetToken}`;
        let emailTemplatePath;
        if (language === "sv") {
            emailTemplatePath = path.resolve(__dirname, "../../views/forgot_password/sv.ejs");
        } else {
            emailTemplatePath = path.resolve(__dirname, "../../views/forgot_password/en.ejs");
        }

        const emailHtml = await ejs.renderFile(emailTemplatePath, {
            resetLink,
            image_logo
        });

        const emailOptions = {
            to: email,
            subject: "Password Reset Request",
            html: emailHtml
        };

        await sendEmail(emailOptions);
        return handleSuccess(res, 200, language, "RESET_PASSWORD_EMAIL_SENT");

    } catch (error) {
        console.error(error);
        return handleError(res, 500, error.message);
    }
};

export const render_forgot_password_page = (req, res) => {
    try {
        return res.render("reset_password/en.ejs");
    } catch (error) {
        return handleError(res, 500, error.message)
    }
};

export const reset_password = async (req, res) => {
    try {
        const resetPasswordSchema = Joi.object({
            token: Joi.string().required(),
            newPassword: Joi.string().min(8).required().messages({
                "string.min": "Password must be at least 8 characters long",
                "any.required": "New password is required",
            }),
        });

        const { error, value } = resetPasswordSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { token, newPassword } = value;

        const [webUser] = await webModels.get_web_user_by_reset_token(token);
        if (!webUser) {
            return handleError(res, 400, webUser.language, "INVALID_EXPIRED_TOKEN");
        }

        if (webUser.show_password === newPassword) {
            return handleError(res, 400, webUser.language, "PASSWORD_CAN_NOT_SAME");
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        const updateResult = await webModels.update_web_user_password(
            hashedPassword,
            newPassword,
            null,
            null,
            webUser.id
        );

        if (updateResult.affectedRows > 0) {
            return handleSuccess(res, 200, webUser.language, "PASSWORD_RESET_SUCCESS");
        } else {
            return handleError(res, 500, webUser.language, "PASSWORD_RESET_FAILED");
        }

    } catch (error) {
        console.error("Error in reset password controller:", error);
        return handleError(res, 500, "en", error.message);
    }
};

export const render_success_reset = (req, res) => {
    return res.render("success_reset/en.ejs")
}

export const set_password = async (req, res) => {
    try {
        const schema = Joi.object({
            new_password: Joi.string().required(),
            language: Joi.string().valid('en', 'sv').required()
        });
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);
        const { new_password, language } = value;

        const [user] = await webModels.get_web_user_by_id(req.user.id);
        if (!user) return handleError(res, 404, 'en', "USER_NOT_FOUND");
        const hashedPassword = await bcrypt.hash(new_password, 10);
        await webModels.update_web_user_password_set(hashedPassword, new_password, user.id, language);
        return handleSuccess(res, 200, language, "PASSWORD_SET_SUCCESSFULLY");
    } catch (error) {
        console.error("Error setting password:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const change_password = async (req, res) => {
    try {
        const schema = Joi.object({
            current_password: Joi.string().required(),
            new_password: Joi.string().required()
        });

        const language = req?.user?.language || 'en';

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { current_password, new_password } = value;

        const [user] = await webModels.get_web_user_by_id(req.user.id);
        if (!user) return handleError(res, 404, 'en', "USER_NOT_FOUND");

        const isPasswordValid = await bcrypt.compare(current_password, user.password);
        if (!isPasswordValid) return handleError(res, 400, 'en', "PASSWORD_INCORRECT");

        const hashedPassword = await bcrypt.hash(new_password, 10);

        await webModels.update_web_user_password_set(hashedPassword, new_password, user.id,language);

        return handleSuccess(res, 200, 'en', "PASSWORD_CHANGED_SUCCESSFULLY");

    } catch (error) {
        console.error("Error changing password:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const create_call_log_user = async (req, res) => {
    try {
        const {
            call_id,
            receiver_doctor_id,
            status,
            started_at // ← Accept started_at from frontend
        } = req.body;

        const { id: sender_user_id, role_name } = req.user;

        if (role_name !== 'USER') {
            return handleError(res, 403, 'en', "Only users can access this endpoint");
        }

        if (!call_id || !status || !receiver_doctor_id || !started_at) {
            return handleError(res, 400, 'en', "Missing required fields");
        }

        await webModels.createOrUpdateCallLog({
            call_id,
            caller_id: sender_user_id,
            sender_user_id,
            sender_doctor_id: null,
            receiver_user_id: null,
            receiver_doctor_id,
            status,
            started_at // ← Pass to model
        });

        return handleSuccess(res, 200, 'en', "Call log created by user");
    } catch (error) {
        console.error("Error in create_call_log_user:", error);
        return handleError(res, 500, 'en', error.message);
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

        const { id: caller_id, role_name, doctorData } = req.user;

        if (role_name !== 'DOCTOR') {
            return handleError(res, 403, 'en', "Only doctors can access this endpoint");
        }

        if (!call_id || !status || !receiver_user_id || !started_at) {
            return handleError(res, 400, 'en', "Missing required fields");
        }

        const sender_doctor_id = doctorData?.doctor_id;

        await webModels.createOrUpdateCallLog({
            call_id,
            caller_id,
            sender_user_id: null,
            sender_doctor_id,
            receiver_user_id,
            receiver_doctor_id: null,
            status,
            started_at // Pass to model
        });

        return handleSuccess(res, 200, 'en', "Call log created by doctor");
    } catch (error) {
        console.error("Error in create_call_log_doctor:", error);
        return handleError(res, 500, 'en', error.message);
    }
};



export const get_all_call_logs = async (req, res) => {
    try {
        const logs = await webModels.getAllCallLogs();

        return handleSuccess(res, 200, 'en', "Fetched all call logs successfully", { logs });
    } catch (error) {
        console.error("Error fetching call logs:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};
export const onboardingByRoleId = async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.string().required(),
            role_id: Joi.string().required(),
        });
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { id, role_id } = value;

        await updateDoctorClinicClaimedProfile(id, role_id);

        const zynqUser = await dbOperations.getData('tbl_zqnq_users', `WHERE id = '${id}' `);

        if (zynqUser.length > 0) {
            const update_role = await dbOperations.updateData('tbl_zqnq_users', { role_id: role_id }, `WHERE id = '${id}' `);
            const updateRoleSelected = await dbOperations.updateData('tbl_zqnq_users', { role_selected: 1 }, `WHERE id = '${id}' `);
            if (role_id == '407595e3-3196-11f0-9e07-0e8e5d906eef') {
                const insert_doctor = await dbOperations.insertData('tbl_doctors', { zynq_user_id: id });
                const getDoctorId = await dbOperations.getSelectedColumn('doctor_id', 'tbl_doctors', `where zynq_user_id ='${id}'`);
                const getClinic = await dbOperations.getSelectedColumn('clinic_id', 'tbl_clinics', `where zynq_user_id ='${id}'`);

                const mapData =
                {
                    doctor_id: getDoctorId[0].doctor_id,
                    clinic_id: getClinic[0].clinic_id,
                    is_invitation_accepted: 1
                }

                await dbOperations.insertData('tbl_doctor_clinic_map', mapData)
            }

            if (update_role.affectedRows > 0) {

                return handleSuccess(res, 200, 'en', "ENROLL_SUCCESSFUL");
            } else {
                return handleError(res, 400, 'en', "USER_NOT_ENROLLED");

            };
        } else {
            return handleError(res, 400, 'en', "USER_NOT_FOUND");
        }

    } catch (error) {
        console.error("Onboarding By Role Id Error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};


export const verifyRoleSelected = async (req, res) => {
    try {
        const schema = Joi.object({
            id: Joi.string().required(),

        });
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { id } = value;

        const zynqUser = await dbOperations.getData('tbl_zqnq_users', `WHERE id = '${id}' `);

        if (zynqUser.length > 0) {
            if (zynqUser[0].role_selected == 1) {
                return handleError(res, 200, 'en', "ROLE_ALREADY_SELECTED");
            } else {
                return handleSuccess(res, 200, 'en', "ROLE_NOT_SELECTED");
            }
        } else {
            return handleError(res, 400, 'en', "USER_NOT_FOUND");
        }

    } catch (error) {
        console.error("Onboarding By Role Id Error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};


export const toggleLanguage = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const result = await webModels.toggleUserLanguage(req.user);
    return handleSuccess(res, 200, language, 'LANGUAGE_UPDATED', result);
})

