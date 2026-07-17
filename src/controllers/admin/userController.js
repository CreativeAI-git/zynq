import Joi from "joi";
import * as adminModels from "../../models/admin.js"
import { asyncHandler, handleError, handleSuccess, joiErrorHandle } from "../../utils/responseHandler.js";
import { NOTIFICATION_MESSAGES, sendNotification } from "../../services/notifications.service.js";
import { isEmpty } from "../../utils/user_helper.js";

export const get_users_managment = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || "";
        const sortBy = req.query.sortBy || "created_at";
        const sortOrder = req.query.sortOrder || "DESC";
        const status = req.query.status || "";
        const startDate = req.query.startDate || "";
        const endDate = req.query.endDate || "";

        const totalRecords = await adminModels.get_users_count(search, status, startDate, endDate);
        const users = await adminModels.get_users_managment(limit, offset, search, sortBy, sortOrder, status, startDate, endDate);
        const faceScanResults = await adminModels.get_all_face_scan_results();

        if (users && users.length > 0) {
            const formattedUsers = users.map(user => ({
                ...user,
                profile_image: user.profile_image
                    ? `${process.env.APP_URL}${user.profile_image}`
                    : null,
                face_scans: faceScanResults.filter(scan =>
                    scan.user_id == user.user_id).map(scan => ({
                        ...scan,
                        face: scan.face && !scan.face.startsWith("http") ? `${process.env.APP_URL}${scan.face}` : scan.face,
                        pdf: scan.pdf ? `${process.env.APP_URL}${scan.pdf}` : scan.pdf
                    }))

            }));


            return handleSuccess(res, 200, 'en', "Fetch user management successfully", {
                users: formattedUsers,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit),
                currentPage: page
            });
        } else {
            return handleSuccess(res, 200, 'en', "No users found", {
                users: [],
                totalRecords,
                totalPages: 0,
                currentPage: page
            });
        }
    } catch (error) {
        console.error("Internal Server Error:", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};


export const update_user_status = async (req, res) => {
    try {
        const schema = Joi.object({
            user_id: Joi.string().required(),
            is_active: Joi.number().valid(0, 1).required()
        });

        const { error, value } = schema.validate(req.body);
        if (error) return joiErrorHandle(res, error);

        const { user_id, is_active } = value;

        const updateResponse = await adminModels.update_user_status(user_id, is_active);

        if (updateResponse && updateResponse.affectedRows > 0) {
            const statusMessage = is_active
                ? "User activated successfully"
                : "User deactivated successfully";

            return handleSuccess(res, 200, 'en', statusMessage, updateResponse);
        } else {
            return handleSuccess(res, 200, 'en', "User not found or status unchanged", {});
        }

    } catch (error) {
        console.error("internal E", error);
        return handleError(res, 500, 'en', "INTERNAL_SERVER_ERROR " + error.message);
    }
};

export const updateUserApprovalStatus = asyncHandler(async (req, res) => {
    const { approval_status, user_id } = req.body;
    const { language = "en" } = req.user;

    const statusMessages = {
        APPROVED: "USER_APPROVED_SUCCESSFULLY",
        REJECTED: "USER_REJECTED_SUCCESSFULLY",
        PENDING: "USER_PENDING_SUCCESSFULLY",
    };

    const notificationUpdates = {
        APPROVED: "user_approved",
        REJECTED: "user_rejected",
        PENDING: "user_pending",
    };

    await Promise.all([
        adminModels.updateUserApprovalStatus(user_id, approval_status),
        sendNotification({
            userData: req.user,
            type: "USER",
            type_id: user_id,
            notification_type: NOTIFICATION_MESSAGES[notificationUpdates[approval_status]],
            receiver_id: user_id,
            receiver_type: "USER"
        })
    ])

    return handleSuccess(res, 200, language, statusMessages[approval_status],);
});

export const updateZynqUserApprovalStatus = asyncHandler(async (req, res) => {
    const { approval_status, zynq_user_id } = req.body;
    const { language = "en" } = req.user;

    const statusMessages = {
        VERIFIED: "USER_VERIFIED_SUCCESSFULLY",
    };

    const notificationUpdates = {
        VERIFIED: "user_verified",
    };

    const userData = await adminModels.getZynqUserData(zynq_user_id);

    if (isEmpty(userData)) {
        return handleError(res, 400, language, "USER_NOT_FOUND");
    }

    await Promise.all([
        adminModels.updateZynqUserApprovalStatus(userData, approval_status),
        sendNotification({
            userData: req.user,
            type: "USER",
            type_id: zynq_user_id,
            notification_type: NOTIFICATION_MESSAGES[notificationUpdates[approval_status]],
            receiver_id: userData.user_id,
            receiver_type: userData.role
        })
    ])

    return handleSuccess(res, 200, language, statusMessages[approval_status],);
});
