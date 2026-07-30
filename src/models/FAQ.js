import db from "../config/db.js";

export const getAllFAQsModel = async (filters = {}) => {
  try {
    const { search, category } = filters;
    let query = `
      SELECT 
        f.*,
        fc.english AS category,
        fc.swedish,
        fc.faq_category_id
      FROM tbl_faqs f
      LEFT JOIN tbl_faq_categories fc 
        ON f.category = fc.faq_category_id
    `;

    const params = [];
    const whereClauses = [];

    // 🔍 Free text search on 4 columns
    if (search) {
      whereClauses.push(
        '(f.ques_en LIKE ? OR f.ans_en LIKE ? OR f.ques_sv LIKE ? OR f.ans_sv LIKE ?)'
      );
      const likeSearch = `%${search}%`;
      params.push(likeSearch, likeSearch, likeSearch, likeSearch);
    }

    // 🎯 Filter by multiple category IDs
    if (Array.isArray(category) && category.length > 0) {
      const placeholders = category.map(() => '?').join(', ');
      whereClauses.push(`f.category IN (${placeholders})`);
      params.push(...category);
    }

    // 🧩 Combine WHERE clauses
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    query += ' ORDER BY f.created_at DESC';

    return await db.query(query, params);
  } catch (error) {
    console.error('Failed to get all FAQs:', error);
    throw error;
  }
};


export const getSingleFAQModel = async (faq_id) => {
  try {
    return await db.query(`
            SELECT f.*, fc.english AS category, fc.swedish, fc.faq_category_id 
            FROM tbl_faqs f
            LEFT JOIN tbl_faq_categories fc ON f.category = fc.faq_category_id
            WHERE f.faq_id = ?`, [faq_id]);
  } catch (error) {
    console.error("Failed to get single FAQ:", error);
    throw error;
  }
}

export const deleteFAQModel = async (faq_id) => {
  try {
    return await db.query('DELETE FROM `tbl_faqs` WHERE faq_id = ?', [faq_id]);
  } catch (error) {
    console.error("Failed to delete FAQ:", error);
    throw error;
  }
}

export const addFAQModel = async (data) => {
  try {
    return await db.query('INSERT INTO `tbl_faqs`(`ques_en`, `ans_en`, `ques_sv`, `ans_sv`, `category`) VALUES (?, ?, ?, ?, ?)', [data.ques_en, data.ans_en, data.ques_sv, data.ans_sv, data.category]);
  } catch (error) {
    console.error("Failed to add FAQ:", error);
    throw error;
  }
}

export const updateFAQModel = async (faq_id, data) => {
  try {
    return await db.query('UPDATE `tbl_faqs` SET ? WHERE faq_id = ?', [data, faq_id]);
  } catch (error) {
    console.error(`Failed to update FAQ (ID: ${faq_id}):`, error);
    throw error;
  }
};

export const getAllFAQCategoriesModel = async (lang = "en") => {
  try {
    // Map language to the right column
    const column = lang === "sv" ? "swedish" : "english";

    const query = `
      SELECT 
        faq_category_id,
        ${column} AS name,
        swedish
      FROM tbl_faq_categories
      ORDER BY ${column};
    `;

    return await db.query(query);
  } catch (error) {
    console.error("Failed to get all FAQ categories:", error);
    throw error;
  }
};

export const getSingleFAQCategoryModel = async (faq_category_id) => {
  try {
    return await db.query('SELECT * FROM `tbl_faq_categories` WHERE faq_category_id = ?', [faq_category_id]);
  } catch (error) {
    console.error("Failed to get single FAQ category:", error);
    throw error;
  }
}

export const deleteFAQCategoryModel = async (faq_category_id) => {
  try {
    return await db.query('DELETE FROM `tbl_faq_categories` WHERE faq_category_id = ?', [faq_category_id]);
  } catch (error) {
    console.error("Failed to delete FAQ category:", error);
    throw error;
  }
}

export const addFAQCategoryModel = async (data) => {
  try {
    return await db.query(`
      INSERT INTO tbl_faq_categories (english, swedish)
      VALUES (?, ?)`, [data.english, data.swedish]);
  } catch (err) {
    console.error("Failed to add FAQ category:", err);
    throw err;
  }
};

export const updateFAQCategoryModel = async (faq_category_id, data) => {
  try {
    return await db.query(
      "UPDATE tbl_faq_categories SET ? WHERE faq_category_id = ?",
      [data, faq_category_id]
    );
  } catch (err) {
    console.error("Failed to update FAQ category:", err);
    throw err;
  }
};

