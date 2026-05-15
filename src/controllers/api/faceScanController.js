import Joi from 'joi';
import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import * as apiModels from '../../models/api.js';
import { sendEmail } from '../../services/send_email.js';
import { isEmpty } from '../../utils/user_helper.js';
import {
    asyncHandler,
    handleError,
    handleSuccess,
    joiErrorHandle,
} from '../../utils/responseHandler.js';
import { getUserSkinTypes, getUserTreatments } from '../../models/clinic.js';
import { faceScanPDFTemplate } from '../../utils/templates.js';
import { saveMessage, uploadMessageFiles } from '../../models/chat.js';
import { __dirname } from '../../../app.js';
import { getTreatmentsAIResult } from '../../utils/global_search.js';
import fs from 'fs';
import { applyLanguageOverwrite } from '../../utils/misc.util.js';

dotenv.config();

const APP_URL = process.env.APP_URL;
const image_logo = process.env.LOGO_URL;

export const add_face_scan_result = async (req, res) => {
    try {
        const user = req?.user;
        const language = user?.language || 'en';

        const schema = Joi.object({
            device_id: Joi.string().optional().allow('', null),
            face_scan_id: Joi.string().optional().allow('', null),
            skin_type: Joi.string().optional().allow('', null),
            skin_concerns: Joi.string().optional().allow('', null),
            details: Joi.any().optional().allow('', null),
            scoreInfo: Joi.any().optional().allow('', null),
            aiAnalysisResult: Joi.string().optional().allow('', null),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const {
            skin_type,
            skin_concerns,
            details,
            scoreInfo,
            aiAnalysisResult,
            face_scan_id,
            device_id,
        } = value;

        // const face = req.file?.location || '';

        let face = null;
        let pdf = null;

        if (req.files) {
            if (req.files['file']) face = req.files['file'][0].filename;
            if (req.files['pdf']) pdf = req.files['pdf'][0].filename;
        }
        const face_scan_result_id = uuidv4(); // Generate UUID

        let face_scan_data = {};
        if (!isEmpty(face_scan_id)) {
            face_scan_data = {
                user_id: user?.user_id || null,
                pdf,
                aiAnalysisResult,
            };

            await apiModels.update_face_scan_data(face_scan_data, face_scan_id);
        } else {
            face_scan_data = {
                device_id,
                user_id: user?.user_id || null,
                face_scan_result_id: face_scan_result_id,
                skin_type,
                skin_concerns,
                details,
                face,
                pdf,
                scoreInfo,
                aiAnalysisResult,
            };

            await apiModels.add_face_scan_data(face_scan_data);
        }

        const responseId =
            face_scan_id && face_scan_id.trim() !== '' ? face_scan_id : face_scan_result_id;

        return handleSuccess(res, 200, language, 'SCAN_DATA_ADDED', { id: responseId });
    } catch (error) {
        console.error('Internal Error:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const get_face_scan_history = async (req, res) => {
    try {
        const face_scan_id = req?.params?.face_scan_id;
        let scan_hostory = await apiModels.get_face_scan_history_v2(req.user?.user_id, face_scan_id);
        if (!scan_hostory) return handleError(res, 404, 'en', 'SCAN_HISTORY_NOT_FOUND');
        scan_hostory.forEach((item) => {
            if (item.face && !item.face.startsWith('http')) item.face = `${APP_URL}${item.face}`;
            if (item.pdf && !item.pdf.startsWith('http')) item.pdf = `${APP_URL}${item.pdf}`;
        });
        return handleSuccess(res, 200, 'en', 'SCAN_HISTORY_DATA', scan_hostory);
    } catch (error) {
        console.error('internal E', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const get_face_scan_history_device = async (req, res) => {
    try {
        const device_id = req?.params?.device_id;
        let scan_hostory = await apiModels.get_face_scan_history_device(device_id);
        if (!scan_hostory) return handleError(res, 404, 'en', 'SCAN_HISTORY_NOT_FOUND');
        scan_hostory.forEach((item) => {
            if (item.face && !item.face.startsWith('http')) item.face = `${APP_URL}${item.face}`;
            if (item.pdf && !item.pdf.startsWith('http')) item.pdf = `${APP_URL}${item.pdf}`;
        });
        return handleSuccess(res, 200, 'en', 'SCAN_HISTORY_DATA', scan_hostory);
    } catch (error) {
        console.error('internal E', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const get_treatments_by_concern_id = async (req, res) => {
    try {
        const schema = Joi.object({
            concern_id: Joi.string().required(),
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        let { concern_id } = value;

        const treatments = await apiModels.getTreatmentsByConcernId(concern_id);

        return handleSuccess(res, 200, 'en', 'APPOINTMENTS_FETCHED', treatments);
    } catch (error) {
        console.error('Error fetching user appointments:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const get_all_concerns = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';
        const concern_ids = req?.body?.concern_ids || [];
        const concerns = await apiModels.getAllConcerns(language, concern_ids);

        return handleSuccess(res, 200, 'en', 'CONCERNS_FETCHED', concerns);
    } catch (error) {
        console.error('Error fetching indications:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const get_treatments_by_concerns = async (req, res) => {
    try {
        const { concern_ids, filters } = req?.body;
        const language = req?.user?.language || 'en';
        console.log("req?.user", req?.user);
        if (filters?.treatment_ids?.length > 0) {
            const treatments = await apiModels.getTreatmentsByIds(filters.treatment_ids, language);
            const newTreatments = await getTreatmentsAIResult(treatments, filters?.search);
            for (var treatment of newTreatments) {
                treatment.sub_treatments = await apiModels.getSubTreatmentsByTreatmentId(
                    treatment.treatment_id,
                    language
                );
                // console.log("sub_treatments", treatment.sub_treatments);
            }
            return handleSuccess(res, 200, 'en', 'TREATMENTS_FETCHED',applyLanguageOverwrite(newTreatments, language));
        } else {
            const treatments = await apiModels.getTreatmentsByConcernIds(concern_ids, language);
            const newTreatments = await getTreatmentsAIResult(treatments, filters?.search);
            for (var treatment of newTreatments) {
                treatment.sub_treatments = await apiModels.getSubTreatmentsByTreatmentId(
                    treatment.treatment_id,
                    language
                );
                // console.log(treatment.sub_treatments);
            }
            return handleSuccess(res, 200, 'en', 'TREATMENTS_FETCHED', applyLanguageOverwrite(newTreatments, language));
        }
    } catch (error) {
        console.error('Error fetching indications:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const get_treatments = asyncHandler(async (req, res) => {
    const language = req?.user?.language || 'en';
    const user_id = req?.user?.user_id;

    const { filters } = req.body;
    const treatments = await apiModels.getAllTreatmentsV2(filters, language, user_id);

    await Promise.all(
        treatments.map(async (treatment) => {
            treatment.sub_treatments = await apiModels.getSubTreatmentsByTreatmentId(
                treatment.treatment_id,
                language
            );
        })
    );
    return handleSuccess(res, 200, 'en', 'TREATMENTS_FETCHED', treatments);
});

export const get_treatments_by_treatments = asyncHandler(async (req, res) => {
    const { treatment_ids, doctor_id ,clinic_id} = req.body;
    const language = req?.user?.language || 'en';

    if(doctor_id && clinic_id){
        const treatments = await apiModels.getTreatmentsByTreatmentIdsAndClinicIdAndDocterId(
            treatment_ids,
            language,
            doctor_id,
            clinic_id
        );
        return handleSuccess(res, 200, 'en', 'TREATMENTS_FETCHED', treatments);
    }
    const treatments = await apiModels.getTreatmentsByTreatmentIds(
        treatment_ids,
        language,
        doctor_id
    );
    return handleSuccess(res, 200, 'en', 'TREATMENTS_FETCHED', treatments);
});

export const get_tips_by_concerns = asyncHandler(async (req, res) => {
    const { concern_ids } = req.body;
    const language = req?.user?.language || 'en';
    const tips = await apiModels.getTipsByConcernIds(concern_ids, language);
    return handleSuccess(res, 200, 'en', 'TIPS_FETCHED', tips);
});

export const getClinicSkinTypes = async (req, res) => {
    try {
        const language = req?.user?.language || 'sv';
        const skinTypes = await getUserSkinTypes(language);
        return handleSuccess(res, 200, language, 'SKIN_TYPES_FETCHED_SUCCESSFULLY', skinTypes);
    } catch (error) {
        console.error('Error in getClinicSkinTypes:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const getTreatments = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';
        const treatments = await getUserTreatments(language);
        return handleSuccess(res, 200, language, 'TREATMENTS_FETCHED_SUCCESSFULLY', treatments);
    } catch (error) {
        console.error('Error in getTreatments:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const sendFaceResultToEmail = async (req, res) => {
    try {
        let { face_scan_result_id } = req.body;

        const email = req?.user?.email;
        const language = req?.user?.language || 'en';

        if (!email) {
            return handleError(res, 400, 'en', 'EMAIL_NOT_FOUND');
        }

        const [faceScanResult] = await apiModels.get_face_scan_result_by_id(
            req.user.user_id,
            face_scan_result_id
        );

        if (isEmpty(faceScanResult)) return handleError(res, 404, 'en', 'FACE_SCAN_RESULT_NOT_FOUND');

        const pdf = faceScanResult.pdf ? `${APP_URL}${faceScanResult.pdf}` : null;

        if (!pdf) return handleError(res, 404, 'en', 'PDF_NOT_FOUND');
        const { subject, body } = faceScanPDFTemplate({ userName: req?.user?.full_name, pdf });

        const attachments = [
            {
                filename: faceScanResult.pdf,
                path: pdf,
            },
        ];

        handleSuccess(res, 200, language, 'REPORT_SENT_SUCCESSFULLY', pdf);

        await sendEmail({ to: email, subject, html: body, attachments });
    } catch (error) {
        console.error('Error in getFaceScanPDF:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};

export const deleteFaceScanResultByIdController = async (req, res) => {
    try {
        let { face_scan_result_id } = req.body;

        const language = req?.user?.language || 'en';


        const [faceScanResult] = await apiModels.getFaceScanResultById(face_scan_result_id );

        if (isEmpty(faceScanResult)) return handleError(res, 404, 'en', 'FACE_SCAN_RESULT_NOT_FOUND');

        const deleteFaceResult = await apiModels.delete_face_scan_result_by_id(face_scan_result_id);

        handleSuccess(res, 200, language, 'REPORT_DELETED_SUCCESSFULLY');
    } catch (error) {
        console.error('Error in getFaceScanPDF:', error);
        return handleError(res, 500, 'en', 'INTERNAL_SERVER_ERROR');
    }
};



export const sendReportToChat = asyncHandler(async (req, res) => {
    const { chat_id, report_id } = req.body;

    const { language = 'en', user_id: sender_user_id } = req.user;

    const [[faceScanResult], saveMessageResult] = await Promise.all([
        apiModels.get_face_scan_result_by_id(sender_user_id, report_id),
        saveMessage(chat_id, sender_user_id, '', 'text'),
    ]);

    if (!faceScanResult?.pdf) return handleError(res, 404, language, 'PDF_NOT_FOUND');

    const pdf = faceScanResult.pdf;
    const messageId = saveMessageResult.insertId;

    const fileInfo = [
        {
            path: pdf,
            type: 'application/pdf',
        },
    ];

    await uploadMessageFiles(chat_id, messageId, fileInfo);

    const originalPath = path.join(__dirname, 'src/uploads/', faceScanResult.pdf);
    const chatFilePath = path.join(__dirname, 'src/uploads/chat_files/', faceScanResult.pdf);

    fs.copyFileSync(originalPath, chatFilePath);

    return handleSuccess(res, 200, language, 'REPORT_SENT_TO_CHAT_SUCCESSFULLY');
});

export const addFace = asyncHandler(async (req, res) => {
    const device_id = req?.body?.device_id || null;
    const user_id = req?.user?.user_id || null;

    if (isEmpty(device_id) && isEmpty(user_id)) {
        return handleError(res, 400, 'en', 'Device id or user id is required');
    }

    if (!req?.files?.face?.length > 0) {
        return handleError(res, 400, 'en', 'Face is required');
    }

    const face = req.files.face[0].filename;
    const filepath = req.files.face[0].path;

    return handleSuccess(res, 200, 'en', 'FACE_ADDED_SUCCESSFULLY');
});