import { addFAQCategoryModel, addFAQModel, deleteFAQCategoryModel, deleteFAQModel, getAllFAQCategoriesModel, getAllFAQsModel, getSingleFAQCategoryModel, getSingleFAQModel, updateFAQCategoryModel, updateFAQModel } from '../../models/FAQ.js';
import { translateFAQ } from '../../utils/misc.util.js';
import { asyncHandler, handleError, handleSuccess } from '../../utils/responseHandler.js';

import { isEmpty } from "../../utils/user_helper.js";

export const getAllFAQs = asyncHandler(async (req, res) => {
    const { filters } = req.body;
    let faqData = await getAllFAQsModel(filters);

    if (req?.user?.role !== "ADMIN") {
        const lang = req?.user?.language || "en";

        faqData = faqData.map(faq => {
            return {
                faq_id: faq.faq_id,
                category: faq.category,
                question: faq[`ques_${lang}`],
                answer: faq[`ans_${lang}`],
                question_en: faq.ques_en,
                question_sv: faq.ques_sv,
                answer_en: faq.ans_en,
                answer_sv: faq.ans_sv
            }
        })
    }

    return handleSuccess(res, 200, 'en', "FAQ_FETCHED_SUCCESSFULLY", faqData);
});

export const getSingleFAQ = asyncHandler(async (req, res) => {
    const { faq_id } = req.params;
    const faqData = await getSingleFAQModel(faq_id);
    if (isEmpty(faqData)) return handleError(res, 404, "en", "FAQ_NOT_FOUND");
    return handleSuccess(res, 200, 'en', "FAQ_FETCHED_SUCCESSFULLY", faqData[0]);
});

const prepareFAQData = async (data) => {
    const { is_manual, question, answer, question_sv, answer_sv, category } = data;

    if (is_manual) {
        return { ques_en: question, ans_en: answer, ques_sv: question_sv, ans_sv: answer_sv, category };
    }

    const translated = await translateFAQ(question, answer);
    
    if (!translated.ans_sv) console.warn("Translation failed for:", question);

    return {
        ques_en: translated.ques_en,
        ans_en: translated.ans_en,
        ques_sv: translated.ques_sv,
        ans_sv: translated.ans_sv,
        category
    };
};

export const addEditFAQ = asyncHandler(async (req, res) => {
    const language = req.user?.language || "en";
    const { faq_id } = req.body;
    const data = await prepareFAQData(req.body);

    const success_message = faq_id ? "FAQ_UPDATED_SUCCESSFULLY" : "FAQ_ADDED_SUCCESSFULLY";

    if (!faq_id) {
        await addFAQModel(data);
    } else {
        await updateFAQModel(faq_id, data);
    }

    return handleSuccess(res, 200, language, success_message);
});


export const deleteFAQ = asyncHandler(async (req, res) => {
    const { faq_id } = req.params;
    await deleteFAQModel(faq_id);
    return handleSuccess(res, 200, 'en', "FAQ_DELETED_SUCCESSFULLY");
});

export const getAllFAQCategories = asyncHandler(async (req, res) => {
    const lang = req?.user?.language || "en";
    const data = await getAllFAQCategoriesModel(lang);
    return handleSuccess(res, 200, lang, "FAQ_CATEGORIES_FETCHED_SUCCESSFULLY", data);
});

export const getSingleFAQCategory = asyncHandler(async (req, res) => {
    const { faq_category_id } = req.params;
    const [data] = await getSingleFAQCategoryModel(faq_category_id);
    if (isEmpty(data)) return handleError(res, 404, 'en', "FAQ_CATEGORY_NOT_FOUND");
    return handleSuccess(res, 200, 'en', "FAQ_CATEGORIES_FETCHED_SUCCESSFULLY", data);
});

export const deleteFAQCategory = asyncHandler(async (req, res) => {
    const { faq_category_id } = req.params;
    await deleteFAQCategoryModel(faq_category_id);
    return handleSuccess(res, 200, 'en', "FAQ_CATEGORY_DELETED_SUCCESSFULLY");
});

export const addEditFAQCategory = asyncHandler(async (req, res) => {
    const { faq_category_id, } = req.body;
    const { language = "en" } = req.user;

    const data = req.body;

    const success_message = faq_category_id ? "FAQ_CATEGORY_UPDATED_SUCCESSFULLY" : "FAQ_CATEGORY_ADDED_SUCCESSFULLY";
    
    if (!faq_category_id) {
        await addFAQCategoryModel(data);
    } else {
        await updateFAQCategoryModel(faq_category_id, data);
    }

    return handleSuccess(res, 200, language, success_message);
});