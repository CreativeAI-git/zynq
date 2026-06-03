const fs = require('fs');
const original = fs.readFileSync('src/controllers/api/doctorController.js', 'utf-8');
const detectSearchIntent = fs.readFileSync('detectSearchIntent_original.js', 'utf-8');
const extractedApi = fs.readFileSync('extracted_api.js', 'utf-8');

fs.writeFileSync('src/controllers/api/doctorController.js', original + '\n\n' + detectSearchIntent + '\n\n' + extractedApi);
