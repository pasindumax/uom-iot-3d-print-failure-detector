const { onObjectFinalized } = require('firebase-functions/v2/storage');
const admin = require('firebase-admin');
const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { classifier } = require('./classifier');

admin.initializeApp();


let isClassifierReady = false;


async function updateFunctionStatus(data) {
    try {
        const statusRef = admin.database().ref('/function_status');
        await statusRef.update({
            ...data,
            lastUpdated: admin.database.ServerValue.TIMESTAMP
        });
    } catch (error) {
        console.error('Error updating function status:', error);
    }
}


async function getQueueCount(bucket) {
    try {
        const [files] = await bucket.getFiles();

        return files.length;
    } catch (error) {
        console.error('Error counting files:', error);
        return 0;
    }
}

exports.processImage = onObjectFinalized({
    memory: '1GiB',
    timeoutSeconds: 300
}, async (event) => {
    const object = event.data;
    const fileBucket = object.bucket;
    const filePath = object.name;
    const contentType = object.contentType;


    if (!contentType.startsWith('image/')) {
        console.log(`Skipping non-image file: ${filePath}`);
        return null;
    }

    const bucket = admin.storage().bucket(fileBucket);
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);

    try {
        console.log(`Job started for: ${fileName}`);

        const queueCount = await getQueueCount(bucket);


        await updateFunctionStatus({
            currentTask: 'Initializing Classifier...',
            fileName: fileName,
            queueCount: queueCount,
            state: 'active',
            error: null
        });

        if (!isClassifierReady) {
            console.log('Classifier not ready. Initializing...');
            await classifier.init();
            isClassifierReady = true;
            console.log('Classifier initialization complete.');
        } else {
            console.log('Using pre-warmed classifier.');
        }


        console.log(`Downloading ${filePath} to ${tempFilePath}`);
        await updateFunctionStatus({ currentTask: 'Downloading image...' });
        await bucket.file(filePath).download({ destination: tempFilePath });


        console.log('Resizing image and extracting features (Grayscale)...');
        await updateFunctionStatus({ currentTask: 'Processing image (Resizing/Grayscale)...' });


        const targetWidth = 96;
        const targetHeight = 96;


        const buffer = await sharp(tempFilePath)
            .resize(targetWidth, targetHeight)
            .grayscale()
            .raw()
            .toBuffer();


        const features = [];
        for (let i = 0; i < buffer.length; i++) {

            features.push(buffer[i]);
        }

        console.log(`Extracted ${features.length} features in range 0-255. (Expected: 9216)`);


        console.log('Running Edge Impulse classification...');
        await updateFunctionStatus({ currentTask: 'Classifying image...' });
        const result = classifier.classify(features);
        console.log('Classification result:', JSON.stringify(result));


        let topResult = null;
        let maxConfidence = -1;

        if (result.results && result.results.length > 0) {
            for (const res of result.results) {
                if (res.value > maxConfidence) {
                    maxConfidence = res.value;
                    topResult = res.label;
                }
            }
        }

        if (topResult) {
            console.log(`Determined Status: ${topResult} (confidence: ${maxConfidence.toFixed(4)})`);


            await updateFunctionStatus({ currentTask: 'Updating database...' });
            const statusRef = admin.database().ref('/latest_print_status');
            await statusRef.set({
                status: topResult,
                confidence: parseFloat(maxConfidence.toFixed(4)),
                updatedAt: admin.database.ServerValue.TIMESTAMP,
                fileName: fileName
            });
            console.log('Realtime database updated successfully.');
        } else {
            console.warn('No classification results found.');
        }


        console.log(`Deleting ${filePath} from Storage...`);
        await updateFunctionStatus({ currentTask: 'Cleaning up...' });
        await bucket.file(filePath).delete();
        console.log('File deleted successfully.');


        await updateFunctionStatus({
            currentTask: 'Idle',
            state: 'idle',
            queueCount: Math.max(0, queueCount - 1)
        });

    } catch (error) {
        console.error('Error processing image:', error);
        await updateFunctionStatus({
            currentTask: 'Error',
            state: 'error',
            error: error.message
        });
    } finally {

        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (unlinkError) {
                console.error('Failed to delete temp file:', unlinkError);
            }
        }
    }
});



