import Joi from "joi";
import ejs from 'ejs';
import path from "path";
import crypto from "crypto";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import jwt from "jsonwebtoken"
import * as apiModels from "../../models/api.js";
import * as webModels from "../../models/web_user.js";
import { sendEmail } from "../../services/send_email.js";
import { generateAccessToken, generateVerificationLink, isEmpty } from "../../utils/user_helper.js";
import { asyncHandler, handleError, handleSuccess, joiErrorHandle } from "../../utils/responseHandler.js";
import twilio from 'twilio';
import { fileTypeFromFile } from 'file-type';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config();

const APP_URL = process.env.APP_URL;
const image_logo = process.env.LOGO_URL;

import * as doctorModels from "../../models/doctor.js";

// -------------------------------------slot managment------------------------------------------------//
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import * as rruleModule from 'rrule';
import { getContactUsData, insertContactUs } from "../../models/appointment.js";
const RRule = rruleModule.RRule || rruleModule.default?.RRule || rruleModule.default;
dayjs.extend(utc);
dayjs.extend(isSameOrBefore);

export const weekdayMap = {
    sunday: RRule.SU,
    monday: RRule.MO,
    tuesday: RRule.TU,
    wednesday: RRule.WE,
    thursday: RRule.TH,
    friday: RRule.FR,
    saturday: RRule.SA,
};


export function generateSlots(startTime, endTime, duration, date) {
    const slots = [];

    let current = dayjs.utc(`${date} ${startTime}`);
    let end = dayjs.utc(`${date} ${endTime}`);

    // If end time is before or equal to start time, assume it spans to next day
    if (end.isSameOrBefore(current)) {
        end = end.add(1, 'day');
    }

    while (current.add(duration, 'minute').isSameOrBefore(end)) {
        const slotStart = current;
        const slotEnd = current.add(duration, 'minute');

        slots.push({
            start_time: slotStart.toISOString(),
            end_time: slotEnd.toISOString(),
        });

        current = slotEnd;
    }

    return slots;
}


const accountSid = process.env.ACCOUNT_SID;
const authToken = process.env.AUTHTOKEN;
const verifyServiceSid = process.env.VERIFY_SERVICE_SID;


const client = twilio(accountSid, authToken);

export const login_with_mobile = async (req, res) => {
    let language = req.body.language || 'en';
    try {
        const sendOtpSchema = Joi.object({
            mobile_number: Joi.string().required(),
            language: Joi.string().valid('sv', 'en').optional().allow("", null),
        });

        const { error, value } = sendOtpSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { mobile_number, language } = value;
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        let [user] = await apiModels.get_user_by_mobile_number(mobile_number);

        if (!user) {
            await apiModels.create_user(mobile_number, otp, language);
            [user] = await apiModels.get_user_by_mobile_number(mobile_number);
        }

        if (user && !user.is_active) {
            return handleError(res, 400, language || 'en', 'ADMIN_DEACTIVATION');
        }

        const user_data = { otp, language };
        await apiModels.update_user(user_data, user.user_id);

        let verification;
        if (mobile_number !== "+46726418049") {
            verification = await client.verify.v2.services(verifyServiceSid)
                .verifications
                .create({
                    to: mobile_number,
                    channel: 'sms',
                });

        }


        return handleSuccess(res, 200, language || 'en', "VERIFICATION_OTP", { otp, sid: verification?.sid || null });

    } catch (error) {
        if (error.code === 60203) {
            return handleError(res, 400, language, "MAX_OTP_ATTEMPTS_REACHED");
        }
        if (error.code === 60410) {
            return handleError(res, 400, language, "PHONE_NUMBER_BLOCKED_BY_TWILIO");
        }

        console.error("Internal error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const login_with_otp = async (req, res) => {
    let language = req.body.language || 'en';
    try {
        const loginOtpSchema = Joi.object({
            device_id: Joi.string().optional().allow("", null),
            mobile_number: Joi.string().required(),
            otp: Joi.string().length(4).required(),
            language: Joi.string().valid("en", "sv").optional().allow("", null),
            fcm_token: Joi.string().optional().allow("", null),
        });

        const { error, value } = loginOtpSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { mobile_number, otp, language, fcm_token, device_id } = value;

        const [user] = await apiModels.get_user_by_mobile_number(mobile_number);
        if (!user) {
            return handleError(res, 404, language || 'en', "USER_NOT_FOUND");
        }

        if (mobile_number !== "+46726418049") {
            const verificationCheck = await client.verify.v2.services(verifyServiceSid)
                .verificationChecks
                .create({ to: mobile_number, code: otp });

            if (verificationCheck.status !== "approved") {
                return handleError(res, 400, language || 'en', "INVALID_OTP");
            }
        }

        // ✅ Verify OTP with Twilio


        const payload = { user_id: user.user_id, mobile_number: user.mobile_number, fcm_token: fcm_token };
        const token = generateAccessToken(payload);

        const user_data = {
            jwt_token: token,
            fcm_token: fcm_token,
            otp: "",
            is_verified: true,
        };

        await apiModels.update_user(user_data, user.user_id);

        if (!isEmpty(device_id)) {
            await apiModels.updateGuestDeviceFaceScanModel(user.user_id, device_id);
        }

        return handleSuccess(res, 200, language || 'en', "LOGIN_SUCCESSFUL", token);

    } catch (error) {
        console.error("Login OTP verification error:", error);

        if (error.code === 20404) {
            return handleError(res, 400, language, "OTP_EXPIRED_OR_INVALID");
        }
        console.error("Login OTP verification error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const getProfile = async (req, res) => {
    try {
        const user = req.user;
        let scan_hostory = await apiModels.get_face_scan_history(req.user?.user_id);
        const language = req.user?.language;
        if (user.profile_image && !user.profile_image.startsWith("http")) {
            user.profile_image = `${APP_URL}${user.profile_image}`;
        }
        let is_onboarding_completed = 0
        if (scan_hostory.length > 0) {
            user.is_onboarding_completed = 1
        }

        return handleSuccess(res, 200, language, "USER_PROFILE", user);
    } catch (error) {
        return handleError(res, 500, 'en', error.message)
    }
};

export const updateProfile = async (req, res) => {
    try {
        const updateProfileSchema = Joi.object({
            full_name: Joi.string().optional().allow("", null),
            gender: Joi.string().valid("Male", "Female", "Other").optional().allow("", null),
            age: Joi.string().optional().allow("", null),
            is_push_notification_on: Joi.boolean().optional().allow("", null),
            is_location_on: Joi.boolean().optional().allow("", null),
            fcm_token: Joi.string().optional().allow("", null),
            latitude: Joi.number().optional().allow(null),
            longitude: Joi.number().optional().allow(null),
            language: Joi.string().optional().allow("", null),
            email: Joi.string().optional().allow("", null),
        });

        const { error, value } = updateProfileSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const user = req.user;
        const language = value.language ?? user?.language;

        const full_name = value.full_name ?? user.full_name;
        const gender = value.gender ?? user.gender;
        const age = value.age ?? user.age;
        const is_push_notification_on = (value.is_push_notification_on !== undefined && value.is_push_notification_on !== null)
            ? value.is_push_notification_on
            : user.is_push_notification_on;

        const is_location_on = (value.is_location_on !== undefined && value.is_location_on !== null)
            ? value.is_location_on
            : user.is_location_on;

        const fcm_token = value.fcm_token ?? user.fcm_token;
        const latitude = value.latitude ?? user.latitude;
        const longitude = value.longitude ?? user.longitude;


        let profile_image = user.profile_image;
        // if (req.file) {
        //     profile_image = (req.file).location;
        // }
        if (req.file && req.file.filename) {
            profile_image = req.file.filename;
        }


        const user_data = {
            profile_image,
            age,
            full_name,
            gender,
            fcm_token,
            is_push_notification_on,
            is_location_on,
            latitude,
            longitude,
            language
        };

        if (value.email) {
            const userExists = await apiModels.get_user_by_email(value.email, user.user_id);

            if (userExists.length > 0) {
                return handleError(res, 200, language, "USER_ALREADY_EXISTS");
            }
            else {
                user_data.email = value.email
            }
        }

        await apiModels.update_user(user_data, user.user_id);

        return handleSuccess(res, 200, language, "PROFILE_UPDATED");

    } catch (error) {
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const deleteAccount = async (req, res) => {
    try {
        const { user_id, language } = req.user;
        const [user] = await apiModels.get_user_by_user_id(user_id)

        if (!user) return handleError(res, 404, language, "USER_NOT_FOUND");
        await apiModels.delete_user(user_id)

        return handleSuccess(res, 200, language, "ACOUNT_DELETED");
    } catch (error) {
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const render_terms_and_condition = (req, res) => {
    try {
        const schema = Joi.object({
            language: Joi.string().valid('en', 'sv').required()
        })
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);
        const { language = 'en' } = value
        if (language == 'en') {
            return res.render("terms_and_condition_en.ejs");

        }
        if (language == 'sv') {
            return res.render("terms_and_condition_sv.ejs");
        }
    } catch (error) {
        console.error("Error rendering forgot password page:", error);
        return handleError(res, 500, "An error occurred while rendering the page")
    }
};

export const render_privacy_policy = (req, res) => {
    try {
        const schema = Joi.object({
            language: Joi.string().valid('en', 'sv').required()
        })
        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);
        const { language = 'en' } = value

        if (language == 'en') {
            return res.render("privacy_and_policy_en.ejs");

        }
        if (language == 'sv') {
            return res.render("privacy_and_policy_sv.ejs");
        }
    } catch (error) {
        console.error("Error rendering forgot password page:", error);
        return handleError(res, 500, "An error occurred while rendering the page")
    }
};
//==================================================================================================

export const register_with_email = async (req, res) => {
    try {
        const registerSchema = Joi.object({
            full_name: Joi.string().required(),
            email: Joi.string().required(),
            mobile_number: Joi.string().required(),
            password: Joi.string().min(8).required(),
            is_push_notification_on: Joi.boolean().required(),
        });
        const { error, value } = registerSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);
        const { full_name, password, email, is_push_notification_on, mobile_number } = value;
        let lower_email = email.toLowerCase();
        const userRepository = getRepository(User);

        const existEmail = await userRepository.findOne({ where: { email: lower_email } });
        if (existEmail) {
            return handleError(res, 400, "Email already exists.");
        }

        const existMobile = await userRepository.findOne({ where: { mobile_number: mobile_number } });
        if (existMobile) {
            return handleError(res, 400, "Mobile Number Already Exists.");
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verifyToken = crypto.randomBytes(32).toString('hex');
        const verifyTokenExpiry = new Date(Date.now() + 3600000);

        const newUser = userRepository.create({
            full_name: full_name,
            mobile_number: mobile_number,
            email: lower_email,
            password: hashedPassword,
            show_password: password,
            verify_token: verifyToken,
            verify_token_expiry: verifyTokenExpiry,
            is_push_notification_on: is_push_notification_on,
        });

        const baseUrl = req.protocol + '://' + req.get('host');
        const verificationLink = generateVerificationLink(verifyToken, baseUrl);
        const emailTemplatePath = path.resolve(__dirname, '../../views/verifyAccount.ejs');
        const emailHtml = await ejs.renderFile(emailTemplatePath, { verificationLink, image_logo });

        const emailOptions = {
            to: lower_email,
            subject: "Verify Your Email Address",
            html: emailHtml,
        };

        await sendEmail(emailOptions);

        await userRepository.save(newUser);
        return handleSuccess(res, 201, `Verification link sent successfully to your email (${lower_email}). Please verify your account.`);
    } catch (error) {
        console.error('Error in register:', error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};


export const enroll_user = async (req, res) => {
    try {
        const enrollSchema = Joi.object({
            full_name: Joi.string().required(),
            email: Joi.string().required(),
            mobile_number: Joi.string().required(),
            application_type: Joi.string().valid('android', 'ios', 'both').required(),
            udid: Joi.string().optional().allow("", null),
            language: Joi.string().valid('sv', 'en').optional().allow("", null),
        });

        const { error, value } = enrollSchema.validate(req.body);
        if (error) return joiErrorHandle(res, error);
        const { email, mobile_number, application_type, udid, full_name, language } = value;
        const android_app_link = process.env.ANDROID_APP_LINK;
        const ios_app_link = process.env.IOS_APP_LINK;
        const lang = language === 'sv' ? 'sv' : 'en';

        const [user] = await apiModels.get_user_by_mobile_number(mobile_number);
        if (user) {
            return handleError(res, 400, lang, "USER_ALREADY_ENROLLED");
        }

        const data = {
            email: email,
            mobile_number: mobile_number
        }

        await apiModels.enroll_user(data)

        const user_data = {
            email,
            application_type,
            mobile_number,
            full_name,
            udid
        }
        const image_logo = `${APP_URL}zynq_logo.png`

        await apiModels.enroll_user_data(user_data);

        const emailTemplatePath = path.resolve(__dirname, `../../views/user_enroll/${lang}.ejs`);
        if (application_type == "android") {
            // const emailTemplatePath = await path.resolve(__dirname, '../../views/user_enroll/en.ejs');
            const emailHtml = await ejs.renderFile(emailTemplatePath, { image_logo, email, android_app_link, application_type: "android", full_name, mobile_number });

            const emailOptions = {
                to: email,
                subject: "Enroll Your Account",
                html: emailHtml,
            };
            await sendEmail(emailOptions);
            return handleSuccess(res, 200, 'en', "ENROLL_SUCCESSFUL");
        }

        if (application_type == "ios") {
            // const emailTemplatePath = await path.resolve(__dirname, '../../views/user_enroll/en.ejs');
            const emailHtml = await ejs.renderFile(emailTemplatePath, { udid, image_logo, email, ios_app_link, application_type: "ios", full_name, mobile_number });

            const emailOptions = {
                to: email,
                subject: "Enroll Your Account",
                html: emailHtml,
            };
            await sendEmail(emailOptions);
            return handleSuccess(res, 200, 'en', "ENROLL_SUCCESSFUL");
        }

        if (application_type == "both") {
            // const emailTemplatePath = await path.resolve(__dirname, '../../views/user_enroll/en.ejs');
            const emailHtml = await ejs.renderFile(emailTemplatePath, { udid, image_logo, email, android_app_link, ios_app_link, application_type: "both", full_name, mobile_number });
            const emailOptions = {
                to: email,
                subject: "Enroll Your Account",
                html: emailHtml,
            };
            await sendEmail(emailOptions);
            return handleSuccess(res, 200, 'en', "ENROLL_SUCCESSFUL");
        }


    } catch (error) {
        console.error('Error in enroll:', error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};

export const create_call_log_user = async (req, res) => {
    const {
        call_id,
        receiver_doctor_id,
        status,
        started_at
    } = req.body;

    const { userData } = req.user;

    if (!call_id || !status || !receiver_doctor_id || !started_at) {
        return handleError(res, 400, 'en', "Missing required fields");
    }

    const sender_user_id = req.user?.user_id || req.user?.id;

    await webModels.createOrUpdateCallLog({
        call_id,
        sender_user_id,
        sender_doctor_id: null,
        receiver_user_id: null,
        receiver_doctor_id,
        status,
        started_at
    });

    return handleSuccess(res, 200, 'en', "Call log created by user");
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

        if (role_name !== 'DOCTOR') {
            return handleError(res, 403, 'en', "Only doctors can access this endpoint");
        }

        if (!call_id || !status || !receiver_user_id || !started_at) {
            return handleError(res, 400, 'en', "Missing required fields");
        }

        const sender_doctor_id = doctorData?.doctor_id;

        await webModels.createOrUpdateCallLog({
            call_id,
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
}


export const getFutureDoctorSlots = async (req, res) => {
    try {
        const { doctor_id, clinic_id } = req.query;

        const today = dayjs().startOf('day');
        const oneMonthLater = today.add(1, 'month');

        const availabilityRows =
            await doctorModels.getDoctorSlotSessionsModel(doctor_id, clinic_id);


        const doctorInfo = await doctorModels.getDoctorInfo(doctor_id, clinic_id);
        const fee_per_session = doctorInfo?.fee_per_session || null;

        if (!availabilityRows || availabilityRows.length === 0) {
            return handleError(res, 400, 'en', "NO_AVAILABILITY_FOUND", []);
        }

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

                    // const start = dayjs.utc(`${dateStr} ${slot.start_time}`, 'YYYY-MM-DD HH:mm:ss', true);
                    // const end = dayjs.utc(`${dateStr} ${slot.end_time}`, 'YYYY-MM-DD HH:mm:ss', true);

                    const start = dayjs(
                        `${dateStr}T${slot.start_time}Z`
                    );

                    const end = dayjs(
                        `${dateStr}T${slot.end_time}Z`
                    );


                    if (!start.isValid() || !end.isValid()) continue;

                    allSlots.push({
                        start_time: start.toISOString(),
                        end_time: end.toISOString()
                    });
                }


            }
        }

        // Remove past slots
        // const now = dayjs.utc();
        // const futureSlots = allSlots.filter(slot =>
        //     dayjs.utc(slot.start_time).isAfter(now)
        // );

        const now = dayjs();

        const futureSlots = allSlots.filter(slot =>
            dayjs(slot.start_time).isAfter(now)
        );


        if (futureSlots.length === 0) {
            return handleError(res, 400, 'en', "NO_SLOTS_FOUND", []);
        }

        // Fetch booked appointments
        const bookedAppointments =
            await doctorModels.fetchAppointmentsBulkModel(
                doctor_id,
                today.format('YYYY-MM-DD'),
                oneMonthLater.format('YYYY-MM-DD')
            );

        // Build lookup map
        const bookedMap = {};
        bookedAppointments.forEach(app => {
            // const dt = dayjs.utc(app.start_time);
            // if (!dt.isValid()) return;
            // bookedMap[dt.toISOString()] = true;
            const dt = dayjs(app.start_time);
            if (!dt.isValid()) return;
            bookedMap[dt.toISOString()] = true;

        });

        // Assign status
        const resultWithStatus = futureSlots.map(slot => ({
            start_time: slot.start_time,
            end_time: slot.end_time,
            status: bookedMap[slot.start_time] ? 'booked' : 'available'
        }));

        const availableSlots = resultWithStatus.filter(slot => slot.status === 'available');

        if (availableSlots.length === 0) {
            return handleError(res, 400, 'en', "NO_AVAILABLE_SLOTS_FOUND", []);
        }

        availableSlots.sort(
            (a, b) => new Date(a.start_time) - new Date(b.start_time)
        );

        return handleSuccess(res, 200, 'en', "FUTURE_DOCTOR_SLOTS", {
            fee_per_session,
            resultWithStatus: availableSlots
        });

    } catch (err) {
        console.error('Error fetching future slots:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const isUserOfflineOrOnline = async (req, res) => {
    try {
        const { user_id, language } = req.user;
        let { isOnline } = req.body
        // const io = getIO();
        await doctorModels.update_doctor_is_online(user_id, isOnline);
        // await toActivateUsers(isOnline, chat_id, doctorId);
        // io.to(doctorId).emit('isUsersOnlineOrOffline', isOnline);
        return handleSuccess(res, 200, language, `USER ${isActive ? 'ONLINE' : 'OFFLINE'}`);
    } catch (error) {
        console.error('error', error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR");
    }
};


export const uploadChatFiles = asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0)
        return handleError(res, 400, 'en', "NO_FILES_UPLOADED");

    const fileInfo = await Promise.all(req.files.map(async (file) => {
        const detectedType = await fileTypeFromFile(file.path);
        return {
            path: file.filename,
            type: detectedType?.mime || file.mimetype || 'application/octet-stream'
        };
    }));

    return handleSuccess(res, 200, 'en', "FILE_UPLOADED", fileInfo);
});

export const deleteMyAccount = asyncHandler(async (req, res) => {
    const { user_id, language } = req.user;
    await apiModels.delete_my_account(user_id)
    return handleSuccess(res, 200, language, "ACCOUNT_DELETED");
});

export const submitContactUs = asyncHandler(async (req, res) => {
    const { language = "en" } = req.user || {};
    const contactData = req.body;
    await insertContactUs(contactData);
    return handleSuccess(res, 201, language, "CONTACT_RECORDS_SAVED_SUCCESSFULLY");
});

export const getContactUs = asyncHandler(async (req, res) => {
    const { language = "en" } = req.user || {};
    const contactData = await getContactUsData();
    return handleSuccess(res, 200, language, "CONTACT_RECORDS_FETCHED_SUCCESSFULLY", contactData);
});

export const guestLogin = asyncHandler(async (req, res) => {
    const { device_id, data, language } = req.body;
    await apiModels.guestLoginModel({ device_id, data });
    return handleSuccess(res, 200, language, "GUEST_LOGIN_SUCCESSFULLY",);
});

export const getGuestFaceScan = asyncHandler(async (req, res) => {
    const { device_id, language } = req.body;
    const data = await apiModels.getGuestFaceScan(device_id);
    return handleSuccess(res, 200, language, "FACE_SCAN_FETCHED", data);
});