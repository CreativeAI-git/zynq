import fs from "fs";
import path from "path";

// Ensure logs directory exists at the root of the project
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const apiLogger = (req, res, next) => {
  const start = Date.now();
  const originalJson = res.json;
  const originalSend = res.send;
  let responseBody = null;

  // Capture response payload from res.json()
  res.json = function (body) {
    responseBody = body;
    return originalJson.apply(res, arguments);
  };

  // Capture response payload from res.send()
  res.send = function (body) {
    if (typeof body === "string") {
      responseBody = body;
    } else if (body instanceof Buffer) {
      responseBody = "[Buffer/Binary Data]";
    }
    return originalSend.apply(res, arguments);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    // 1️⃣ Formatted Console Logging
    console.log(`\n=================== [API LOG] ===================`);
    console.log(`⏰ Time: ${new Date().toISOString()}`);
    console.log(`📡 Request: ${req.method} ${req.originalUrl}`);
    console.log(`📦 Payload (Request Body):`, JSON.stringify(req.body, null, 2));
    console.log(`🛑 Status: ${res.statusCode} | ⚡ Duration: ${duration}ms`);
    if (responseBody) {
      const responseString = typeof responseBody === "object" ? JSON.stringify(responseBody, null, 2) : responseBody;
      const truncatedResponse = responseString.length > 1000 ? `${responseString.slice(0, 1000)}... [Truncated]` : responseString;
      console.log(`💬 Response Body:`, truncatedResponse);
    }
    console.log(`=================================================\n`);

    // 2️⃣ daily File Logging (logs/api_access_YYYY-MM-DD.log)
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const logFileName = `api_access_${today}.log`;
    const logFilePath = path.join(logsDir, logFileName);

    const logEntry = `
[${new Date().toISOString()}]
Request: ${req.method} ${req.originalUrl}
Headers: ${JSON.stringify(req.headers)}
Payload: ${JSON.stringify(req.body)}
Status: ${res.statusCode} | Duration: ${duration}ms
Response: ${typeof responseBody === "object" ? JSON.stringify(responseBody) : responseBody}
--------------------------------------------------------------------------------------\n`;

    fs.appendFile(logFilePath, logEntry, (err) => {
      if (err) {
        console.error("❌ Failed to write log to file:", err);
      }
    });
  });

  next();
};

export default apiLogger;
