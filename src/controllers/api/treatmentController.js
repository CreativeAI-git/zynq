import {
    getAllConcerns,
    addConcernModel,
    addTreatmentConcernsModel, addTreatmentDeviceNameModel,
    getAllTreatmentsModel, getTreatmentsByTreatmentId, getSubTreatmentsByTreatmentId,
    addTreatmentModel, addSubTreatmentModel, checkExistingConcernModel, checkExistingTreatmentModel,
    deleteConcernModel, deleteExistingConcernsModel,
    deleteTreatmentDeviceNameModel,
    deleteTreatmentModel, deleteZynqUserConcernsModel, deleteZynqUserTreatmentsModel, updateConcernApprovalStatusModel,
    updateConcernModel, updateTreatmentApprovalStatusModel, updateTreatmentModel, updateSubtreatmentModel,
    deleteSubTreatmentModel,
    updateSubTreatmentUserMap,
    addSubTreatmentUserMap,
    getSubTreatmentModel,
    updateSubtreatmentMasterModel,
    addSubTreatmentMasterModel,
    getSubTreatmentMasterByName,
    deleteSubTreatmentMasterModel,
    getAllSubTreatmentsMasterModel,
    deleteTreatmentSubTreatmentsModel,
    addTreatmentSubTreatmentModel,
    deleteZynqUserSubTreatmentsModel,
    addTreatmentSubTreatmentUserModel,
    getUserSubTreatmentsByTreatmentId,
    getTreatmentsByZynqUserId,
    addUserMappedSubTreatmentsToMaster,
    getTreatmentByIdModel,
    getTreatmentConcernsModel,
    getTreatmentDevicesModel,
    getTreatmentSubTreatmentsModel,
    deleteUserSubTreatmentsModel1,
    checkExistingLikeWiseTermsModel,
    updateLikeWiseTermsModel,
    addLikeWiseTermsModel,
    deleteLikeWiseTermsModel,
    deleteZynqUserLikeWiseTermsModel,
    updateLikeWiseTermsApprovalStatusModel,
    checkExistingDeviceModel,
    updateDeviceModel,
    addDeviceModel,
    deleteDeviceModel,
    deleteZynqUserDeviceModel,
    updateDeviceApprovalStatusModel,
    checkExistingBenifitsModel,
    updateBenifitsModel,
    addBenifitsModel,
    deleteZynqUserBenefitModel,
    deleteBenefitModel,
    updateBenefitApprovalStatusModel,
    getAllBenefitsModel,
    getAllDevicesModel,
    getAllLikeWiseTermsModel,
    getLikeWiseTermsByIdsModel,
    getDevicesByIdsModel,
    getConcernsByIdsModel,
    deleteLikeWiseTermTreatmentModel,
    deleteTreatmentDevicesModel,
    deleteTreatmentConcernsModel,
    deleteTreatmentBenefitsModel,
    insertTreatmentBenefitsModel,
    insertTreatmentDevicesModel,
    insertTreatmentConcernsModel,
    insertTreatmentLikeWiseTermsModel,
    getBenefitsByIdsModel,
    getTreatmentBenefitsModel,
    getTreatmentLikeWiseTermsModel,
    checkExistingTreatmentByNameModel,
    checkExistingSubTreatmentByNameModel,
    checkExistingSubTreatmentMasterByNameModel,
    checkExistingConcernByNameModel,
    checkExistingLikeWiseTermsByNameModel,
    checkExistingDeviceByNameModel,
    checkExistingBenefitByNameModel
} from "../../models/admin.js";
import { getTreatmentsByConcernId } from "../../models/api.js";
import { NOTIFICATION_MESSAGES, sendNotification } from "../../services/notifications.service.js";
import { asyncHandler, handleError, handleSuccess, } from "../../utils/responseHandler.js";
import { googleTranslator, isEmpty } from "../../utils/user_helper.js";
import { v4 as uuidv4 } from "uuid";
import { generateTreatmentEmbeddingsV2 } from "./embeddingsController.js";
import db from "../../config/db.js";
import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';
import { applyLanguageOverwrite } from "../../utils/misc.util.js";

export const getTreatmentsByConcern = asyncHandler(async (req, res) => {
    const { concern_id } = req.params;
    const treatmentsData = await getTreatmentsByConcernId(concern_id);
    if (isEmpty(treatmentsData)) return handleError(res, 404, "en", "TREATMENT_NOT_FOUND");
    return handleSuccess(res, 200, 'en', "TREATMENTS_FETCHED_SUCCESSFULLY", treatmentsData);
});

export const addEditTreatment = asyncHandler(async (req, res) => {
    const { treatment_id, ...body } = req.body;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || 'en';
    const isAdmin = role === "ADMIN";
    const dbData = { ...body };
    dbData.swedish = await googleTranslator(dbData.name, "sv");
    // dbData.benefits_sv = await googleTranslator(dbData.benefits_en, "sv");
    dbData.description_sv = await googleTranslator(dbData.description_en, "sv");


    const benefits_ids = dbData.benefits_ids;
    const device_ids = dbData.device_ids;
    const like_wise_terms_ids = dbData.like_wise_terms_ids;
    const concerns_ids = dbData.concerns_ids;

    const benefits = await getBenefitsByIdsModel(benefits_ids);
    const devices = await getDevicesByIdsModel(device_ids);
    const like_wise_terms = await getLikeWiseTermsByIdsModel(like_wise_terms_ids);
    const concerns = await getConcernsByIdsModel(concerns_ids);

    dbData.benefits_en = benefits.map((benefit) => benefit.name).join(', ') || null;
    dbData.benefits_sv = benefits.map((benefit) => benefit.swedish).join(', ') || null;
    dbData.device_name = devices.map((device) => device.name).join(', ') || null;
    dbData.like_wise_terms = like_wise_terms.map((like_wise_term) => like_wise_term.name).join(', ') || null;

    // 🧩 Creator metadata
    if (isAdmin) {
        dbData.created_by_zynq_user_id = null;
        dbData.is_admin_created = true;
        dbData.approval_status = "APPROVED";
    } else {
        dbData.created_by_zynq_user_id = user_id;
        dbData.is_admin_created = false;
        dbData.approval_status = "PENDING";
    }

    // Convert arrays → comma-separated for DB fields
    if (Array.isArray(dbData.device_name)) dbData.device_name = dbData.device_name.join(',');
    if (Array.isArray(dbData.like_wise_terms)) dbData.like_wise_terms = dbData.like_wise_terms.join(',');

    const [existingTreatmentByName] = await checkExistingTreatmentByNameModel(
        dbData.name,
        dbData.swedish,
        treatment_id || null
    );
    if (existingTreatmentByName) {
        return handleError(res, 409, language, "TREATMENT_ALREADY_EXISTS");
    }

    // ✳️ EDIT FLOW
    if (treatment_id) {

        // 🛡️ Non-admin ownership check
        if (!isAdmin) {
            const [existing] = await checkExistingTreatmentModel(treatment_id, user_id);
            if (!existing) return handleError(res, 403, language, "NOT_AUTHORIZED_TO_EDIT_TREATMENT");
        }

        const updateTreatment = {
            name: dbData.name,
            swedish: dbData.swedish,
            device_name: dbData.device_name,
            like_wise_terms: dbData.like_wise_terms,
            classification_type: dbData.classification_type,
            benefits_en: dbData.benefits_en,
            benefits_sv: dbData.benefits_sv,
            description_en: dbData.description_en,
            description_sv: dbData.description_sv,
            source: dbData.source,
            is_device: dbData.is_device,
            is_admin_created: dbData.is_admin_created,
            created_by_zynq_user_id: dbData.created_by_zynq_user_id,
            approval_status: dbData.approval_status,
        };

        // 🧹 Cleanup & reinsert in EDIT mode
        await Promise.all([
            updateTreatmentModel(treatment_id, updateTreatment),
            deleteExistingConcernsModel(treatment_id),
            deleteTreatmentDeviceNameModel(treatment_id),
            !isAdmin && deleteUserSubTreatmentsModel1(treatment_id),
            !isAdmin
                ?
                deleteZynqUserSubTreatmentsModel(treatment_id)
                : deleteTreatmentSubTreatmentsModel(treatment_id),
            deleteLikeWiseTermTreatmentModel(treatment_id),
            deleteTreatmentDevicesModel(treatment_id),
            deleteTreatmentConcernsModel(treatment_id),
            deleteTreatmentBenefitsModel(treatment_id),
        ]);

        // // Insert fresh mappings
        // if (dbData.concerns?.length > 0)
        //     await addTreatmentConcernsModel(treatment_id, dbData.concerns);

        // if (req.body.device_name?.length > 0)
        //     await addTreatmentDeviceNameModel(treatment_id, req.body.device_name);

        await insertTreatmentBenefitsModel(treatment_id, benefits);
        await insertTreatmentDevicesModel(treatment_id, devices);
        await insertTreatmentConcernsModel(treatment_id, concerns);
        await insertTreatmentLikeWiseTermsModel(treatment_id, like_wise_terms);

        if (req.body.sub_treatments?.length > 0)
            console.log({ sub_treatments: req.body.sub_treatments, treatment_id })
        if (!isAdmin) await addTreatmentSubTreatmentUserModel(treatment_id, req.body.sub_treatments, user_id);
        if (isAdmin) await addTreatmentSubTreatmentModel(treatment_id, req.body.sub_treatments);

    }

    // ✳️ CREATE FLOW
    else {
        dbData.treatment_id = uuidv4();

        const addTreatment = {
            treatment_id: dbData.treatment_id,
            name: dbData.name,
            swedish: dbData.swedish,
            device_name: dbData.device_name,
            like_wise_terms: dbData.like_wise_terms,
            classification_type: dbData.classification_type,
            benefits_en: dbData.benefits_en,
            benefits_sv: dbData.benefits_sv,
            description_en: dbData.description_en,
            description_sv: dbData.description_sv,
            source: dbData.source,
            is_device: dbData.is_device,
            is_admin_created: dbData.is_admin_created,
            created_by_zynq_user_id: dbData.created_by_zynq_user_id,
            approval_status: dbData.approval_status,
        };

        await addTreatmentModel(addTreatment);

        // if (dbData.concerns?.length > 0)
        //     await addTreatmentConcernsModel(dbData.treatment_id, dbData.concerns);

        // if (req.body.device_name?.length > 0)
        //     await addTreatmentDeviceNameModel(dbData.treatment_id, req.body.device_name);


        await insertTreatmentBenefitsModel(dbData.treatment_id, benefits);
        await insertTreatmentDevicesModel(dbData.treatment_id, devices);
        await insertTreatmentConcernsModel(dbData.treatment_id, concerns);
        await insertTreatmentLikeWiseTermsModel(dbData.treatment_id, like_wise_terms);

        if (req.body.sub_treatments?.length > 0)
            if (!isAdmin) await addTreatmentSubTreatmentUserModel(dbData.treatment_id, req.body.sub_treatments, user_id);
        if (isAdmin) await addTreatmentSubTreatmentModel(dbData.treatment_id, req.body.sub_treatments);
    }

    // FINAL RESPONSE
    const message = treatment_id
        ? "TREATMENT_UPDATED_SUCCESSFULLY"
        : "TREATMENT_ADDED_SUCCESSFULLY";

    handleSuccess(res, 200, language, message, {
        treatment_id: treatment_id || dbData.treatment_id
    });
});

export const addEditSubtreatment = asyncHandler(async (req, res) => {
    const { treatment_id, sub_treatment_id, ...body } = req.body;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    const isAdmin = role === "ADMIN";

    const dbData = { ...body };
    dbData.swedish = await googleTranslator(dbData.name, "sv");

    // 🧩 Creator metadata
    if (isAdmin) {
        dbData.is_admin_created = true;
        dbData.approval_status = "APPROVED";
    } else {
        dbData.is_admin_created = false;
        dbData.created_by_zynq_user_id = user_id;
        dbData.approval_status = "PENDING";
    }

    let newSubTreatmentId = sub_treatment_id;

    const [existingSubTreatmentByName] = await checkExistingSubTreatmentByNameModel(
        treatment_id,
        dbData.name,
        dbData.swedish,
        sub_treatment_id || null
    );
    if (existingSubTreatmentByName) {
        return handleError(res, 409, language, "SUBTREATMENT_ALREADY_EXISTS");
    }

    // ✳️ EDIT FLOW
    if (sub_treatment_id) {
        const updateSubTreatment = {
            treatment_id: treatment_id,
            name: dbData.name,
            swedish: dbData.swedish,
            is_admin_created: dbData.is_admin_created,
            approval_status: dbData.approval_status,
        };

        await updateSubtreatmentModel(sub_treatment_id, updateSubTreatment);

        // 👉 Update mapping if created by non-admin
        if (!isAdmin) {
            await updateSubTreatmentUserMap(
                sub_treatment_id,
                user_id,
                {
                    approval_status: dbData.approval_status
                }
            );
        }
    }

    // ✳️ CREATE FLOW
    else {
        console.log("user_id=>", user_id)
        const addSubTreatment = {
            treatment_id: treatment_id,
            name: dbData.name,
            swedish: dbData.swedish,
            is_admin_created: dbData.is_admin_created,
            approval_status: dbData.approval_status,
            created_by_zynq_user_id: user_id
        };

        const insertResult = await addSubTreatmentModel(addSubTreatment);
        const newData = await getSubTreatmentModel(treatment_id, dbData.name);
        console.log("newData", newData)
        newSubTreatmentId = newData?.sub_treatment_id;

        // 👉 Insert mapping if created by non-admin
        if (!isAdmin) {
            await addSubTreatmentUserMap({
                sub_treatment_id: newSubTreatmentId,
                zynq_user_id: user_id,
                approval_status: dbData.approval_status
            });
        }
    }

    // Response
    handleSuccess(res, 200, language,
        sub_treatment_id
            ? "SUBTREATMENT_UPDATED_SUCCESSFULLY"
            : "SUBTREATMENT_ADDED_SUCCESSFULLY",
        { sub_treatment_id: newSubTreatmentId }
    );
});

export const addEditSubTreatmentMaster = asyncHandler(async (req, res) => {
    const { sub_treatment_id, ...body } = req.body;

    const user_id = req.user?.id;
    const role = req.user?.role;
    const language = req.user?.language || "en";

    const isAdmin = role === "ADMIN";

    let dbData = { ...body };

    // 🌍 Auto translate name → Swedish
    dbData.swedish = await googleTranslator(dbData.name, "sv");

    // 🔐 Set creator & approval logic
    if (isAdmin) {
        dbData.approval_status = "APPROVED";
        dbData.is_admin_created = 1;
        dbData.created_by = null;
    } else {
        dbData.approval_status = "PENDING";
        dbData.is_admin_created = 0;
        dbData.created_by = user_id;
    }

    let newId = sub_treatment_id;

    const [existingSubTreatmentMasterByName] = await checkExistingSubTreatmentMasterByNameModel(
        dbData.name,
        dbData.swedish,
        sub_treatment_id || null
    );
    if (existingSubTreatmentMasterByName) {
        return handleError(res, 409, language, "SUB_TREATMENT_MASTER_ALREADY_EXISTS");
    }

    /*
    |--------------------------------------------------------------------------
    | ✳️ UPDATE FLOW
    |--------------------------------------------------------------------------
    */
    if (sub_treatment_id) {
        const updateData = {
            name: dbData.name,
            swedish: dbData.swedish,
            approval_status: dbData.approval_status,
            is_admin_created: dbData.is_admin_created,
            created_by: dbData.created_by
        };

        await updateSubtreatmentMasterModel(sub_treatment_id, updateData);
    }

    /*
    |--------------------------------------------------------------------------
    | ✳️ CREATE FLOW
    |--------------------------------------------------------------------------
    */
    else {
        const insertData = {
            name: dbData.name,
            swedish: dbData.swedish,
            approval_status: dbData.approval_status,
            is_admin_created: dbData.is_admin_created,
            created_by: dbData.created_by
        };

        await addSubTreatmentMasterModel(insertData);

        // Fetch newly created ID using name (assuming unique name)
        const newRow = await getSubTreatmentMasterByName(dbData.name);
        newId = newRow?.sub_treatment_id;
    }

    // Response
    handleSuccess(
        res,
        200,
        language,
        sub_treatment_id
            ? "SUB_TREATMENT_MASTER_UPDATED_SUCCESSFULLY"
            : "SUB_TREATMENT_MASTER_ADDED_SUCCESSFULLY",
        { sub_treatment_id: newId }
    );
});

export const deleteTreatment = asyncHandler(async (req, res) => {
    const { treatment_id } = req.params;
    const role = req.user?.role;
    const user_id = req.user?.id;

    const language = req.user?.language || 'en';

    if (role === "ADMIN") {
        await deleteTreatmentModel(treatment_id)
    } else {
        const deleted = await deleteZynqUserTreatmentsModel(treatment_id, user_id);
        if (deleted.affectedRows === 0) {
            return handleError(res, 403, language, "NOT_AUTHORIZED_TO_DELETE_TREATMENT");
        }
    }

    return handleSuccess(res, 200, language, "TREATMENT_DELETED_SUCCESSFULLY");
});

export const deleteSubTreatment = asyncHandler(async (req, res) => {
    const { sub_treatment_id } = req.params;
    const role = req.user?.role;
    const user_id = req.user?.id;
    console.log(user_id, '<=user_id')

    const language = req.user?.language || 'en';
    if (role === "ADMIN") {
        await deleteSubTreatmentModel(sub_treatment_id)
    } else {
        const deleted = await deleteZynqUserSubTreatmentsModel(sub_treatment_id, user_id);
        console.log(deleted, '<=data')
        if (deleted.affectedRows === 0) {
            return handleError(res, 403, language, "NOT_AUTHORIZED_TO_DELETE_SUB_TREATMENT");
        }
    }


    return handleSuccess(res, 200, language, "SUB_TREATMENT_DELETED_SUCCESSFULLY");
});

export const deleteSubTreatmentMaster = asyncHandler(async (req, res) => {
    const { sub_treatment_id } = req.params;
    // const role = req.user?.role;
    // const user_id = req.user?.id;
    // console.log(user_id, '<=user_id')

    const language = req.user?.language || 'en';

    await deleteSubTreatmentMasterModel(sub_treatment_id)

    return handleSuccess(res, 200, language, "SUB_TREATMENT_DELETED_SUCCESSFULLY");
});



export const updateTreatmentApprovalStatus = asyncHandler(async (req, res) => {
    const { approval_status, treatment_id } = req.body;
    const { language = "en" } = req.user;

    const statusMessages = {
        APPROVED: "TREATMENT_APPROVED_SUCCESSFULLY",
        REJECTED: "TREATMENT_REJECTED_SUCCESSFULLY",
    };

    const notificationUpdates = {
        APPROVED: "treatment_approved",
        REJECTED: "treatment_rejected",
    };

    const [treatmentData] = await updateTreatmentApprovalStatusModel(treatment_id, approval_status);
    // NEW FEATURE: Auto-add user sub-treatments to admin table
    if (approval_status === "APPROVED") {
        await addUserMappedSubTreatmentsToMaster(treatment_id, treatmentData.created_by_zynq_user_id);
    }

    handleSuccess(res, 200, language, statusMessages[approval_status]);

    // Send Notification
    if (treatmentData) {
        await sendNotification({
            userData: req.user,
            type: "TREATMENT",
            type_id: treatment_id,
            notification_type: NOTIFICATION_MESSAGES[notificationUpdates[approval_status]],
            receiver_id: treatmentData.role === "CLINIC" ? treatmentData.clinic_id : treatmentData.doctor_id,
            receiver_type: treatmentData.role === "CLINIC" ? "CLINIC" : "DOCTOR",
        });
    }
});

export const get_all_concerns = async (req, res) => {
    try {
        const language = req?.user?.language || 'en';
        const concerns = await getAllConcerns(language);

        return handleSuccess(res, 200, "en", "CONCERNS_FETCHED", applyLanguageOverwrite(concerns, language));
    } catch (error) {
        console.error("Error fetching indications:", error);
        return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
};

export const getAllTreatments = asyncHandler(async (req, res) => {
    const role = req.user?.role;
    const zynq_user_id = req.user?.id;
    const language = req.user?.language || 'en';

    const isAdmin = role === "ADMIN";

    let treatments = [];
    if (!isAdmin) {
        treatments = await getTreatmentsByZynqUserId(zynq_user_id);
    } else {
        treatments = await getAllTreatmentsModel();
    }

    const approved = [];
    const others = [];

    for (const item of treatments) {
        if (item.approval_status === "APPROVED") {
            approved.push(item);
        } else {
            others.push(item);
        }
    }

    const response = {
        ALL: treatments,
        APPROVED: approved,
        OTHERS: others
    };

    return handleSuccess(res, 200, language, "TREATMENTS_FETCHED", applyLanguageOverwrite(response, language));
});

export const getAllSubTreatmentMasters = asyncHandler(async (req, res) => {
    const language = req?.user?.language || "en";

    const subTreatments = await getAllSubTreatmentsMasterModel();

    const approved = [];
    const others = [];

    for (const item of subTreatments) {
        if (item.approval_status === "APPROVED") {
            approved.push(item);
        } else {
            others.push(item);
        }
    }

    const response = {
        ALL: subTreatments,
        APPROVED: approved,
        OTHERS: others
    };

    return handleSuccess(res, 200, language, "SUB_TREATMENTS_FETCHED", applyLanguageOverwrite(response, language));
});


export const getAllTreatmentById = asyncHandler(async (req, res) => {
    const { treatment_id } = req.query;
    const role = req.user?.role;
    const zynq_user_id = req.user?.id;
    const language = req.user?.language || 'en';

    const isAdmin = role === "ADMIN";

    let treatments = [];

    // Different fetch logic for admin vs user
    if (!isAdmin) {
        treatments = await getTreatmentsByTreatmentId(treatment_id);
    } else {
        treatments = await getTreatmentsByTreatmentId(treatment_id, zynq_user_id);
    }

    if (treatments.length === 0) {
        return handleError(res, 404, language, "TREATMENT_NOT_FOUND");
    }

    // Add sub-treatments for each treatment
    await Promise.all(
        treatments.map(async (t) => {
            if (!isAdmin) {
                // Non-admin: fetch user-based sub-treatments
                t.sub_treatments = await getUserSubTreatmentsByTreatmentId(
                    t.treatment_id,
                    zynq_user_id,
                    language
                );
            } else {
                // Admin: fetch all approved sub-treatments
                t.sub_treatments = await getSubTreatmentsByTreatmentId(
                    t.treatment_id,
                    language
                );
            }
        })
    );

    return handleSuccess(res, 200, language, "TREATMENTS_FETCHED", applyLanguageOverwrite(treatments[0], language));
});

export const addEditConcern = asyncHandler(async (req, res) => {
    const { concern_id: input_concern_id, ...body } = req.body;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    const isAdmin = role === "ADMIN";
    let dbData = { ...body };

    dbData.swedish = await googleTranslator(dbData.name, "sv");

    // 🧩 Metadata
    if (isAdmin) {
        dbData.is_admin_created = true;
        dbData.approval_status = "APPROVED";
    } else {
        dbData.created_by_zynq_user_id = user_id;
    }

    let concern_id = input_concern_id;

    // ✳️ EDIT FLOW
    if (concern_id) {
        const [existingConcern] = await checkExistingConcernByNameModel(dbData.name, dbData.swedish, concern_id);
        if (existingConcern) {
            return handleError(res, 409, language, "CONCERN_ALREADY_EXISTS");
        }

        if (!isAdmin) {
            const [existing] = await checkExistingConcernModel(concern_id, user_id);
            if (!existing) {
                return handleError(res, 403, language, "NOT_AUTHORIZED_TO_EDIT_CONCERN");
            }
        }

        await updateConcernModel(concern_id, dbData);
    }
    // ✳️ CREATE FLOW
    else {
        const [existingConcern] = await checkExistingConcernByNameModel(dbData.name, dbData.swedish);
        if (existingConcern) {
            return handleError(res, 409, language, "CONCERN_ALREADY_EXISTS");
        }

        concern_id = uuidv4();
        dbData.concern_id = concern_id;

        await addConcernModel(dbData);
    }

    const message = input_concern_id
        ? "CONCERN_UPDATED_SUCCESSFULLY"
        : "CONCERN_ADDED_SUCCESSFULLY";

    return handleSuccess(res, 200, language, message, { concern_id });
});

export const deleteConcern = asyncHandler(async (req, res) => {
    const { concern_id } = req.params;
    const role = req.user?.role;
    const user_id = req.user?.id;

    const language = req.user?.language || 'en';

    if (role === "ADMIN") {
        await deleteConcernModel(concern_id)
    } else {
        const deleted = await deleteZynqUserConcernsModel(concern_id, user_id);
        if (deleted.affectedRows === 0) {
            return handleError(res, 403, language, "NOT_AUTHORIZED_TO_DELETE_CONCERN");
        }
    }

    return handleSuccess(res, 200, language, "CONCERN_DELETED_SUCCESSFULLY");
});

export const updateConcernApprovalStatus = asyncHandler(async (req, res) => {
    const { approval_status, concern_id } = req.body;
    const { language = "en" } = req.user;

    // 🧩 Map messages dynamically based on status
    const statusMessages = {
        APPROVED: "CONCERN_APPROVED_SUCCESSFULLY",
        REJECTED: "CONCERN_REJECTED_SUCCESSFULLY",
    };

    const notificationUpdates = {
        APPROVED: "concern_approved",
        REJECTED: "concern_rejected",
    };

    // 🔹 Update approval status and fetch concern creator details
    const [concernData] = await updateConcernApprovalStatusModel(concern_id, approval_status);

    // ✅ Respond immediately to client
    handleSuccess(res, 200, language, statusMessages[approval_status]);

    // 🔔 Send notification asynchronously (non-blocking)
    if (concernData) {
        await sendNotification({
            userData: req.user,
            type: "CONCERN",
            type_id: concern_id,
            notification_type: NOTIFICATION_MESSAGES[notificationUpdates[approval_status]],
            receiver_id: concernData.role === "CLINIC" ? concernData.clinic_id : concernData.doctor_id,
            receiver_type: concernData.role === "CLINIC" ? "CLINIC" : "DOCTOR",
        });
    }
});

export const import_treatments_from_CSV = async (req, res) => {
    const role = req.user?.role;
    const language = req.user?.language || "en";

    // Admin only
    if (role !== "ADMIN") {
        return handleError(res, 403, language, "ONLY_ADMIN_CAN_IMPORT_TREATMENTS");
    }

    const filePath = req.file?.path;
    if (!filePath) return handleError(res, 400, language, "CSV_REQUIRED");

    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet);

        if (!rows.length) {
            fs.unlinkSync(filePath);
            return handleError(res, 400, language, "CSV_EMPTY");
        }

        // Fetch existing treatments (by name for duplicate prevention)
        const existingRows = await db.query(
            `SELECT name FROM tbl_treatments`
        );

        const existingList = Array.isArray(existingRows) ? existingRows : [];
        const existingNames = new Set(existingList.map(r => (r.name || "").trim().toLowerCase()));

        const seenCSV = new Set(); // for deduplication inside CSV
        const toInsert = [];

        for (const row of rows) {
            const name = (row.name || "").trim();

            if (!name) continue;

            const lowerName = name.toLowerCase();

            // Skip duplicates
            if (existingNames.has(lowerName) || seenCSV.has(lowerName)) continue;

            seenCSV.add(lowerName);

            const treatment_id = uuidv4();

            // Clean fields
            const concernsArr = (row.concerns || "").split(",").map(c => c.trim()).filter(Boolean);
            const deviceArr = (row.device_name || "").split(",").map(d => d.trim()).filter(Boolean);

            // Prepare translated fields
            const swedish = await googleTranslator(name, "sv");
            const benefits_sv = await googleTranslator(row.benefits_en || "", "sv");
            const description_sv = await googleTranslator(row.description_en || "", "sv");

            const treatmentObject = {
                treatment_id,
                name,
                swedish,
                device_name: row.device_name || "",
                like_wise_terms: row.like_wise_terms || "",
                classification_type: row.classification_type || "",
                benefits_en: row.benefits_en || "",
                benefits_sv,
                description_en: row.description_en || "",
                description_sv,
                source: row.source || "",
                is_device: row.is_device === "true" || row.is_device === "1",
                is_admin_created: true,
                created_by_zynq_user_id: null,
                approval_status: "APPROVED",
                _concerns: concernsArr,
                _devices: deviceArr
            };

            toInsert.push(treatmentObject);
        }

        if (!toInsert.length) {
            fs.unlinkSync(filePath);
            return handleError(res, 400, language, "NO_NEW_RECORDS");
        }

        // Insert each treatment and its related rows
        for (const t of toInsert) {
            await addTreatmentModel(t);

            if (t._concerns.length > 0) {
                await addTreatmentConcernsModel(t.treatment_id, t._concerns);
            }

            if (t._devices.length > 0) {
                await addTreatmentDeviceNameModel(t.treatment_id, t._devices);
            }
        }

        fs.unlinkSync(filePath);
        return handleSuccess(res, 200, language, "TREATMENT_IMPORT_SUCCESS", {
            inserted: toInsert.length,
        });

    } catch (error) {
        console.error("Import failed:", error);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return handleError(res, 500, language, "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const cloneTreatment = asyncHandler(async (req, res) => {
    const { treatment_id } = req.params;
    const language = req.user?.language || 'en';

    // 1️⃣ Fetch original treatment
    const original = await getTreatmentByIdModel(treatment_id);
    if (!original) {
        return handleError(res, 404, language, "TREATMENT_NOT_FOUND");
    }

    // 2️⃣ Fetch relation IDs
    const [
        benefitMappings,
        deviceMappings,
        concernMappings,
        likeWiseMappings,
        subTreatments
    ] = await Promise.all([
        getTreatmentBenefitsModel(treatment_id),
        getTreatmentDevicesModel(treatment_id),
        getTreatmentConcernsModel(treatment_id),
        getTreatmentLikeWiseTermsModel(treatment_id),
        getTreatmentSubTreatmentsModel(treatment_id)
    ]);

    const benefit_ids = benefitMappings.map(b => b.benefit_id);
    const device_ids = deviceMappings.map(d => d.device_id);
    const concern_ids = concernMappings.map(c => c.concern_id);
    const like_wise_term_ids = likeWiseMappings.map(l => l.like_wise_term_id);

    // 3️⃣ Fetch master data
    const [benefits, devices, concerns, like_wise_terms] = await Promise.all([
        getBenefitsByIdsModel(benefit_ids),
        getDevicesByIdsModel(device_ids),
        getConcernsByIdsModel(concern_ids),
        getLikeWiseTermsByIdsModel(like_wise_term_ids),
    ]);

    // 4️⃣ Prepare DB-friendly values
    const newTreatmentId = uuidv4();

    const clonedTreatment = {
        treatment_id: newTreatmentId,
        name: `${original.name}`,
        swedish: original.swedish,
        classification_type: original.classification_type,
        benefits_en: benefits.map(b => b.name).join(', ') || null,
        benefits_sv: benefits.map(b => b.swedish).join(', ') || null,
        device_name: devices.map(d => d.name).join(', ') || null,
        like_wise_terms: like_wise_terms.map(l => l.name).join(', ') || null,
        description_en: original.description_en,
        description_sv: original.description_sv,
        source: original.source,
        is_device: original.is_device,
        is_admin_created: true,
        created_by_zynq_user_id: null,
        approval_status: "APPROVED",
    };

    // 5️⃣ Insert treatment
    await addTreatmentModel(clonedTreatment);

    // 6️⃣ Insert relations (same as addEditTreatment CREATE)
    await Promise.all([
        insertTreatmentBenefitsModel(newTreatmentId, benefits),
        insertTreatmentDevicesModel(newTreatmentId, devices),
        insertTreatmentConcernsModel(newTreatmentId, concerns),
        insertTreatmentLikeWiseTermsModel(newTreatmentId, like_wise_terms),
    ]);

    if (subTreatments?.length > 0) {
        await addTreatmentSubTreatmentModel(newTreatmentId, subTreatments);
    }

    // 7️⃣ Response
    handleSuccess(res, 201, language, "TREATMENT_CLONED_SUCCESSFULLY", {
        treatment_id: newTreatmentId
    });
});


// export const cloneTreatment = asyncHandler(async (req, res) => {
//     const { treatment_id } = req.params;
//     const role = req.user?.role;
//     const language = req.user?.language || 'en';


//     // 1️⃣ Fetch original treatment
//     const original = await getTreatmentByIdModel(treatment_id);
//     if (!original) {
//         return handleError(res, 404, language, "TREATMENT_NOT_FOUND");
//     }


//     // 2️⃣ Fetch relations
//     const [concerns, devices, subTreatments] = await Promise.all([
//         getTreatmentConcernsModel(treatment_id),
//         getTreatmentDevicesModel(treatment_id),
//         getTreatmentSubTreatmentsModel(treatment_id)
//     ]);

//     // 3️⃣ Create new treatment
//     const newTreatmentId = uuidv4();

//     const clonedTreatment = {
//         treatment_id: newTreatmentId,
//         name: `${original.name}`,
//         swedish: original.swedish,
//         device_name: original.device_name,
//         like_wise_terms: original.like_wise_terms,
//         classification_type: original.classification_type,
//         benefits_en: original.benefits_en,
//         benefits_sv: original.benefits_sv,
//         description_en: original.description_en,
//         description_sv: original.description_sv,
//         source: original.source,
//         is_device: original.is_device,
//         is_admin_created: true,
//         created_by_zynq_user_id: null,
//         approval_status: "APPROVED",
//     };

//     await addTreatmentModel(clonedTreatment);


//     // 4️⃣ Insert relations
//     if (concerns.length)
//         await addTreatmentConcernsModel(newTreatmentId, concerns);

//     if (devices.length)
//         await addTreatmentDeviceNameModel(newTreatmentId, devices);

//     if (subTreatments.length)
//         await addTreatmentSubTreatmentModel(newTreatmentId, subTreatments);

//     // 5️⃣ Response
//     handleSuccess(res, 201, language, "TREATMENT_CLONED_SUCCESSFULLY", {
//         treatment_id: newTreatmentId
//     });
// });


export const addEditLikeWiseTerms = asyncHandler(async (req, res) => {
    const { like_wise_term_id: input_likewise_id, ...body } = req.body;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    const isAdmin = role === "ADMIN";
    let dbData = { ...body };

    dbData.swedish = await googleTranslator(dbData.name, "sv");

    // 🧩 Metadata
    if (isAdmin) {
        dbData.is_admin_created = true;
        dbData.approval_status = "APPROVED";
    } else {
        dbData.created_by_zynq_user_id = user_id;
    }

    let like_wise_term_id = input_likewise_id;

    // ✳️ EDIT FLOW
    if (like_wise_term_id) {
        const [existingLikeWiseTerm] = await checkExistingLikeWiseTermsByNameModel(dbData.name, dbData.swedish, like_wise_term_id);
        if (existingLikeWiseTerm) {
            return handleError(res, 409, language, "LIKEWISETERM_ALREADY_EXISTS");
        }

        if (!isAdmin) {
            const [existing] = await checkExistingLikeWiseTermsModel(like_wise_term_id, user_id);
            if (!existing) {
                return handleError(res, 403, language, "NOT_AUTHORIZED_TO_EDIT_CONCERN");
            }
        }

        await updateLikeWiseTermsModel(like_wise_term_id, dbData);
    }
    // ✳️ CREATE FLOW
    else {
        const [existingLikeWiseTerm] = await checkExistingLikeWiseTermsByNameModel(dbData.name, dbData.swedish);
        if (existingLikeWiseTerm) {
            return handleError(res, 409, language, "LIKEWISETERM_ALREADY_EXISTS");
        }

        like_wise_term_id = uuidv4();
        dbData.like_wise_term_id = like_wise_term_id;

        await addLikeWiseTermsModel(dbData);
    }

    const message = input_likewise_id
        ? "LIKEWISETERM_UPDATED_SUCCESSFULLY"
        : "LIKEWISETERM_ADDED_SUCCESSFULLY";

    return handleSuccess(res, 200, language, message, { like_wise_term_id });
});

export const deleteLikeWiseTerms = asyncHandler(async (req, res) => {
    const { like_wise_term_id } = req.params;
    const role = req.user?.role;
    const user_id = req.user?.id;

    const language = req.user?.language || 'en';

    if (role === "ADMIN") {
        await deleteLikeWiseTermsModel(like_wise_term_id)
    } else {
        const deleted = await deleteZynqUserLikeWiseTermsModel(like_wise_term_id, user_id);
        if (deleted.affectedRows === 0) {
            return handleError(res, 403, language, "NOT_AUTHORIZED_TO_DELETE_LIKEWISETERM");
        }
    }

    return handleSuccess(res, 200, language, "LIKEWISETERM_DELETED_SUCCESSFULLY");
});

export const updateLikeWiseTermsApprovalStatus = asyncHandler(async (req, res) => {
    const { approval_status, like_wise_term_id } = req.body;
    const { language = "en" } = req.user;

    // 🧩 Map messages dynamically based on status
    const statusMessages = {
        APPROVED: "LIKEWISETERM_APPROVED_SUCCESSFULLY",
        REJECTED: "LIKEWISETERM_REJECTED_SUCCESSFULLY",
    };

    const notificationUpdates = {
        APPROVED: "LIKEWISETERM_approved",
        REJECTED: "LIKEWISETERM_rejected",
    };

    // 🔹 Update approval status and fetch concern creator details
    const [concernData] = await updateLikeWiseTermsApprovalStatusModel(like_wise_term_id, approval_status);

    // ✅ Respond immediately to client
    handleSuccess(res, 200, language, statusMessages[approval_status]);

    // 🔔 Send notification asynchronously (non-blocking)
    if (concernData) {
        await sendNotification({
            userData: req.user,
            type: "LIKEWISETERM",
            type_id: like_wise_term_id,
            notification_type: NOTIFICATION_MESSAGES[notificationUpdates[approval_status]],
            receiver_id: concernData.role === "CLINIC" ? concernData.clinic_id : concernData.doctor_id,
            receiver_type: concernData.role === "CLINIC" ? "CLINIC" : "DOCTOR",
        });
    }
});

export const addEditDevice = asyncHandler(async (req, res) => {
    const { device_id: input_device_id, ...body } = req.body;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    const isAdmin = role === "ADMIN";
    let dbData = { ...body };

    dbData.swedish = await googleTranslator(dbData.name, "sv");

    // 🧩 Metadata
    if (isAdmin) {
        dbData.is_admin_created = true;
        dbData.approval_status = "APPROVED";
    } else {
        dbData.created_by_zynq_user_id = user_id;
    }

    let device_id = input_device_id;

    // ✳️ EDIT FLOW
    if (device_id) {
        const [existingDeviceByName] = await checkExistingDeviceByNameModel(dbData.name, dbData.swedish, device_id);
        if (existingDeviceByName) {
            return handleError(res, 409, language, "DEVICE_ALREADY_EXISTS");
        }

        if (!isAdmin) {
            const [existing] = await checkExistingDeviceModel(device_id, user_id);
            if (!existing) {
                return handleError(res, 403, language, "NOT_AUTHORIZED_TO_EDIT_DEVICE");
            }
        }

        await updateDeviceModel(device_id, dbData);
    }
    // ✳️ CREATE FLOW
    else {
        const [existingDeviceByName] = await checkExistingDeviceByNameModel(dbData.name, dbData.swedish);
        if (existingDeviceByName) {
            return handleError(res, 409, language, "DEVICE_ALREADY_EXISTS");
        }

        device_id = uuidv4();
        dbData.device_id = device_id;

        await addDeviceModel(dbData);
    }

    const message = input_device_id
        ? "DEVICE_UPDATED_SUCCESSFULLY"
        : "DEVICE_ADDED_SUCCESSFULLY";

    return handleSuccess(res, 200, language, message, { device_id });
});

export const deleteDevice = asyncHandler(async (req, res) => {
    const { device_id } = req.params;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    if (role === "ADMIN") {
        await deleteDeviceModel(device_id);
    } else {
        const deleted = await deleteZynqUserDeviceModel(device_id, user_id);
        if (deleted.affectedRows === 0) {
            return handleError(res, 403, language, "NOT_AUTHORIZED_TO_DELETE_DEVICE");
        }
    }

    return handleSuccess(res, 200, language, "DEVICE_DELETED_SUCCESSFULLY");
});

export const updateDeviceApprovalStatus = asyncHandler(async (req, res) => {
    const { approval_status, device_id } = req.body;
    const { language = "en" } = req.user;

    const statusMessages = {
        APPROVED: "DEVICE_APPROVED_SUCCESSFULLY",
        REJECTED: "DEVICE_REJECTED_SUCCESSFULLY",
    };

    const notificationUpdates = {
        APPROVED: "device_approved",
        REJECTED: "device_rejected",
    };

    // 🔹 Update approval status & fetch creator
    const [deviceData] = await updateDeviceApprovalStatusModel(device_id, approval_status);

    handleSuccess(res, 200, language, statusMessages[approval_status]);

    // 🔔 Async notification
    if (deviceData) {
        await sendNotification({
            userData: req.user,
            type: "DEVICE",
            type_id: device_id,
            notification_type: NOTIFICATION_MESSAGES[notificationUpdates[approval_status]],
            receiver_id:
                deviceData.role === "CLINIC"
                    ? deviceData.clinic_id
                    : deviceData.doctor_id,
            receiver_type:
                deviceData.role === "CLINIC" ? "CLINIC" : "DOCTOR",
        });
    }
});


export const addEditBenefit = asyncHandler(async (req, res) => {
    const { benefit_id: input_benefit_id, ...body } = req.body;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    const isAdmin = role === "ADMIN";
    let dbData = { ...body };

    dbData.swedish = await googleTranslator(dbData.name, "sv");

    // 🧩 Metadata
    if (isAdmin) {
        dbData.is_admin_created = true;
        dbData.approval_status = "APPROVED";
    } else {
        dbData.created_by_zynq_user_id = user_id;
    }

    let benefit_id = input_benefit_id;

    // ✳️ EDIT FLOW
    if (benefit_id) {
        const [existingBenefitByName] = await checkExistingBenefitByNameModel(dbData.name, dbData.swedish, benefit_id);
        if (existingBenefitByName) {
            return handleError(res, 409, language, "BENEFIT_ALREADY_EXISTS");
        }

        if (!isAdmin) {
            const [existing] = await checkExistingBenifitsModel(benefit_id, user_id);
            if (!existing) {
                return handleError(res, 403, language, "NOT_AUTHORIZED_TO_EDIT_BENEFIT");
            }
        }

        await updateBenifitsModel(benefit_id, dbData);
    }
    // ✳️ CREATE FLOW
    else {
        const [existingBenefitByName] = await checkExistingBenefitByNameModel(dbData.name, dbData.swedish);
        if (existingBenefitByName) {
            return handleError(res, 409, language, "BENEFIT_ALREADY_EXISTS");
        }

        benefit_id = uuidv4();
        dbData.benefit_id = benefit_id;

        await addBenifitsModel(dbData);
    }

    const message = input_benefit_id
        ? "BENEFIT_UPDATED_SUCCESSFULLY"
        : "BENEFIT_ADDED_SUCCESSFULLY";

    return handleSuccess(res, 200, language, message, { benefit_id });
});

export const deleteBenefit = asyncHandler(async (req, res) => {
    const { benefit_id } = req.params;
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    if (role === "ADMIN") {
        await deleteBenefitModel(benefit_id);
    } else {
        const deleted = await deleteZynqUserBenefitModel(benefit_id, user_id);
        if (deleted.affectedRows === 0) {
            return handleError(res, 403, language, "NOT_AUTHORIZED_TO_DELETE_BENEFIT");
        }
    }

    return handleSuccess(res, 200, language, "BENEFIT_DELETED_SUCCESSFULLY");
});

export const updateBenefitApprovalStatus = asyncHandler(async (req, res) => {
    const { approval_status, benefit_id } = req.body;
    const { language = "en" } = req.user;

    const statusMessages = {
        APPROVED: "BENEFIT_APPROVED_SUCCESSFULLY",
        REJECTED: "BENEFIT_REJECTED_SUCCESSFULLY",
    };

    const notificationUpdates = {
        APPROVED: "benefit_approved",
        REJECTED: "benefit_rejected",
    };

    // 🔹 Update approval status & fetch creator
    const [benefitData] = await updateBenefitApprovalStatusModel(benefit_id, approval_status);

    handleSuccess(res, 200, language, statusMessages[approval_status]);

    // 🔔 Async notification
    if (benefitData) {
        await sendNotification({
            userData: req.user,
            type: "BENEFIT",
            type_id: benefit_id,
            notification_type: NOTIFICATION_MESSAGES[notificationUpdates[approval_status]],
            receiver_id:
                benefitData.role === "CLINIC"
                    ? benefitData.clinic_id
                    : benefitData.doctor_id,
            receiver_type:
                benefitData.role === "CLINIC" ? "CLINIC" : "DOCTOR",
        });
    }
});


export const getAllLikeWiseTerms = asyncHandler(async (req, res) => {
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    // const isAdmin = role === "ADMIN";

    const isAdmin = true;

    const data = await getAllLikeWiseTermsModel(
        isAdmin ? null : user_id,
        isAdmin
    );

    return handleSuccess(
        res,
        200,
        language,
        "LIKEWISETERM_FETCHED_SUCCESSFULLY",
        data
    );
});

export const getAllDevices = asyncHandler(async (req, res) => {
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    // const isAdmin = role === "ADMIN";

        const isAdmin = true;

    const data = await getAllDevicesModel(
        isAdmin ? null : user_id,
        isAdmin
    );

    return handleSuccess(
        res,
        200,
        language,
        "DEVICE_FETCHED_SUCCESSFULLY",
        data
    );
});

export const getAllBenefits = asyncHandler(async (req, res) => {
    const role = req.user?.role;
    const user_id = req.user?.id;
    const language = req.user?.language || "en";

    // const isAdmin = role === "ADMIN";

    const isAdmin = true;

    const data = await getAllBenefitsModel(
        isAdmin ? null : user_id,
        isAdmin
    );

    return handleSuccess(
        res,
        200,
        language,
        "BENEFIT_FETCHED_SUCCESSFULLY",
        data
    );
});
