import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import base64url from 'base64url';
import dotenv from "dotenv";
import dayjs from 'dayjs';
import axios from 'axios';
import { protectTermsInText, restoreProtectedTerms, restoreCanonicalBrandTerms } from "../search/protected_terms.js";
dotenv.config();
const APP_URL = process.env.APP_URL;

import { handleError, handleSuccess } from '../utils/responseHandler.js';
import * as appointmentModel from '../models/appointment.js';
import { getDocterByDocterId } from '../models/doctor.js';
import { getChatBetweenUsers } from '../models/chat.js';

export const generateRandomString = async (length) => {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
};

export const generateVerificationLink = (token, baseUrl) => {
    return `${baseUrl}/api/verify-email?token=${token}`;
};

export const generateAccessTokenAdmin = (payload) => {
    const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
    const JWT_EXPIRY = process.env.JWT_EXPIRY;
    return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

export const generateAccessToken = (payload) => {
    const USER_JWT_SECRET = process.env.USER_JWT_SECRET;
    const JWT_EXPIRY = process.env.JWT_EXPIRY;
    return jwt.sign(payload, USER_JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

export const generateAccessTokenVerifyAdmin = (payload) => {
    const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
    return jwt.verify(payload, ADMIN_JWT_SECRET);
};

export const generateAccessTokenVerify = (payload) => {
    const USER_JWT_SECRET = process.env.USER_JWT_SECRET;
    return jwt.verify(payload, USER_JWT_SECRET);
};

export const generateToken = () => {
    return Math.random().toString(36).substr(2, 12);
}

export const generatePassword = (email) => {
    const username = email.split('@')[0];
    const firstName = username.split('.')[0];

    const upperCaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowerCaseChars = 'abcdefghijklmnopqrstuvwxyz';
    const numberChars = '0123456789';
    const specialChars = '@#$%&';

    const getRandomChar = (chars) => chars.charAt(Math.floor(Math.random() * chars.length));

    const randomUpperCase = getRandomChar(upperCaseChars);
    const randomLowerCase = getRandomChar(lowerCaseChars);
    const randomNumber = getRandomChar(numberChars);
    const randomSpecial = getRandomChar(specialChars);

    let base = firstName.padEnd(4, 'x').slice(0, 4);

    const combined = base + randomUpperCase + randomLowerCase + randomNumber + randomSpecial;

    const shuffled = combined
        .split('')
        .sort(() => Math.random() - 0.5)
        .join('');

    return shuffled;
};

export const generateSupportTicketId = () => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const randomNumber = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const ticketId = `#${dd}${mm}${yyyy}-000${randomNumber}`;
    return ticketId;
}
export const cosineSimilarity = (a, b) => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}


export const isEmpty = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'boolean' || typeof value === 'number') return false;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (value instanceof Map || value instanceof Set) return value.size === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
};

export const splitIDs = (str = "") =>
    str
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

export const formatImagePath = (path, folder = '') =>
    !path
        ? null
        : path.startsWith('http')
            ? path
            : folder
                ? `${APP_URL}${folder}/${path}`
                : `${APP_URL}${path}`;


export const getAppointmentDetails = async (userId, appointmentId) => {
    const appointments = await appointmentModel.getAppointmentsById(userId, appointmentId);

    if (!appointments || appointments.length === 0) {
        return {}; // No appointment found
    }

    const app = appointments[0]; // Since appointment_id is unique, take the first result

    const doctor = await getDocterByDocterId(app.doctor_id);
    const chatId = await getChatBetweenUsers(userId, doctor[0].zynq_user_id);
    app.chatId = chatId.length > 0 ? chatId[0].id : null;

    if (app.profile_image && !app.profile_image.startsWith('http')) {
        app.profile_image = `${APP_URL}doctor/profile_images/${app.profile_image}`;
    }

    if (app.pdf && !app.pdf.startsWith('http')) {
        app.pdf = `${APP_URL}${app.pdf}`;
    }

    const localFormattedStart = app.start_time ? dayjs(app.start_time).format("YYYY-MM-DD HH:mm:ss") : null;
    const localFormattedEnd = app.end_time ? dayjs(app.end_time).format("YYYY-MM-DD HH:mm:ss") : null;

    const startUTC = localFormattedStart ? dayjs.utc(localFormattedStart) : null;
    const endUTC = localFormattedEnd ? dayjs.utc(localFormattedEnd) : null;
    const now = dayjs.utc();

    const videoCallOn = now.isAfter(startUTC) && now.isBefore(endUTC);

    const treatments = await appointmentModel.getAppointmentTreatments(appointmentId);

    return {
        ...app,
        start_time: localFormattedStart ? startUTC.toISOString() : null,
        end_time: localFormattedEnd ? endUTC.toISOString() : null,
        videoCallOn,
        treatments
    };
};

// export const googleTranslator = async (text, targetLang) => {
//     const apiKey = process.env.GOOGLE_TRANSLATE_KEY;
//     const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
//     const response = await fetch(url, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//             q: text,
//             target: targetLang,
//         }),
//     });
//     console.log(response);
//     return
//     const data = await response.json();
//     if (data && data.data && data.data.translations && data.data.translations.length > 0) {
//         return data.data.translations[0].translatedText;
//     } else {
//         throw new Error('Translation failed');
//     }
// };

export const googleTranslator = async (question, targetLang) => {
    try {
        const restored = restoreCanonicalBrandTerms(question || "");
        const { protectedText, map } = protectTermsInText(restored);
        const url = `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_TRANSLATE_KEY}`;
        const body = {
            q: protectedText,
            target: targetLang,
            format: 'text'
        };

        const resp = await axios.post(url, body);
        const translated = resp.data.data.translations[0].translatedText;
        return restoreProtectedTerms(translated, map);
    } catch (err) {
        console.error('Translate error:', err.response?.data || err.message);
        throw err;
    }
};
