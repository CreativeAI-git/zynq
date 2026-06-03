const fs = require('fs');
const diffLines = fs.readFileSync('temp_diff_utf8.txt', 'utf-8').split('\n');
const outLines = [];
let capture = false;
for (const line of diffLines) {
    if (line.includes('export const getDoctorsByFirstNameSearchOnlyController')) {
        capture = true;
    }
    if (capture) {
        if (line.startsWith('+')) {
            outLines.push(line.substring(1));
        } else if (line.startsWith(' ') || line === '') {
            outLines.push(line.substring(1));
        }
    }
}
fs.writeFileSync('extracted_api.js', outLines.join('\n'));
