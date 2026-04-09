const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { classifier } = require('./classifier');

admin.initializeApp();

// Ensure classifier is initialized before standard execution
let isClassifierReady = false;

exports.processImage = functions.storage.object().onFinalize(async (object) => {
    const fileBucket = object.bucket;
    const filePath = object.name;
    const contentType = object.contentType;

    // Exit if this is triggered on a file that is not an image
    if (!contentType.startsWith('image/')) {
        return null;
    }

    // Prepare temp file path
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    
    const bucket = admin.storage().bucket(fileBucket);

    try {
        if (!isClassifierReady) {
            await classifier.init();
            isClassifierReady = true;
        }

        // 1. Download file to temp directory
        console.log(`Downloading ${filePath} to ${tempFilePath}`);
        await bucket.file(filePath).download({ destination: tempFilePath });

        // 2. Read image with sharp, resize to 96x96, and get raw RGB values
        console.log('Resizing image and extracting features...');
        const buffer = await sharp(tempFilePath)
            .resize(96, 96)
            .removeAlpha() // Ensure only RGB
            .raw()
            .toBuffer();

        // 3. Convert raw RGB buffer to the format expected by Edge Impulse
        // Edge Impulse uses a flat array where each pixel is an integer: (R << 16) | (G << 8) | B
        const features = [];
        for (let i = 0; i < buffer.length; i += 3) {
            const r = buffer[i];
            const g = buffer[i + 1];
            const b = buffer[i + 2];
            features.push((r << 16) | (g << 8) | b);
        }

        // 4. Run classification
        console.log('Running Edge Impulse classification...');
        const result = classifier.classify(features);
        console.log('Classification result:', JSON.stringify(result));

        // 5. Determine the status (e.g. 'fail' or 'pass')
        // Pick the label with the highest confidence value
        let topResult = null;
        let maxConfidence = -1;
        for (const res of result.results) {
            if (res.value > maxConfidence) {
                maxConfidence = res.value;
                topResult = res.label;
            }
        }
        
        console.log(`Determined Status: ${topResult} (confidence: ${maxConfidence})`);

        // 6. Update Realtime Database
        if (topResult) {
            await admin.database().ref('/latest_print_status').set({
                status: topResult,
                confidence: maxConfidence,
                updatedAt: admin.database.ServerValue.TIMESTAMP
            });
            console.log('Realtime database updated successfully.');
        }

        // 7. Delete the original file from Storage as requested
        console.log(`Deleting ${filePath} from Storage...`);
        await bucket.file(filePath).delete();
        console.log('File deleted successfully.');

    } catch (error) {
        console.error('Error processing image:', error);
    } finally {
        // Cleanup local temp file
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    }
});
