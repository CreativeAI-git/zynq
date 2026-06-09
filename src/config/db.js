import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  database: process.env.DB_DATABASE,
  timezone: "Z",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 20000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export async function connectDB() {
  try {
    const connection = await pool.getConnection();
    console.log("✅ MySQL pool connected successfully");
    connection.release();
  } catch (err) {
    console.error("❌ Database pool connection failed:", err.message);
    throw err;
  }
}

export const db = {
  query: async (sql, params) => {
    try {
      const [rows] = await pool.query(sql, params);
      return rows || []; // ensures it always returns an array
    } catch (err) {
      const retryable = ["ETIMEDOUT", "ECONNRESET", "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR"].includes(err?.code);
      console.error("DB Query Error:", {
        code: err?.code,
        message: err?.message,
        sqlState: err?.sqlState,
        sqlMessage: err?.sqlMessage
      });

      if (retryable) {
        try {
          const [rows] = await pool.query(sql, params);
          return rows || [];
        } catch (retryErr) {
          console.error("DB Query Retry Failed:", {
            code: retryErr?.code,
            message: retryErr?.message,
            sqlState: retryErr?.sqlState,
            sqlMessage: retryErr?.sqlMessage
          });
        }
      }

      return []; // return empty array on error if you want to avoid crashes
    }
  },
  getConnection: () => pool.getConnection(),
  close: () => pool.end(),
};

export default db;

