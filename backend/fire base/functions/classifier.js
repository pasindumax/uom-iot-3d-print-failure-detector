const Module = require('./model/edge-impulse-standalone');

let classifierInitialized = false;

class EdgeImpulseClassifier {
    constructor() {
        this.initialized = false;
    }

    async init() {
        if (classifierInitialized) return;


        if (Module.ready && typeof Module.ready.then === 'function') {
            await Module.ready;
        }

        return new Promise((resolve, reject) => {
            if (classifierInitialized) return resolve();


            if (Module.instance || Module.calledRun) {
                try {
                    this._doInit();
                    return resolve();
                } catch (err) {
                    return reject(err);
                }
            }

            Module.onRuntimeInitialized = () => {
                try {
                    this._doInit();
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };


            setTimeout(() => {
                if (!classifierInitialized) {
                    console.warn('Initialization timeout, attempting forced init...');
                    try {
                        this._doInit();
                        resolve();
                    } catch (err) {

                        console.error('Forced init failed:', err);
                    }
                }
            }, 5000);
        });
    }

    _doInit() {
        if (classifierInitialized) return;

        if (typeof Module.init !== 'function') {
            throw new Error('Module.init is not a function. WASM module might not be loaded correctly.');
        }

        const ret = Module.init();
        if (typeof ret === 'number' && ret !== 0) {
            throw new Error('init() failed with code ' + ret);
        }
        classifierInitialized = true;

        const props = this.getProperties();
        console.log('Edge Impulse Model Initialized:');
        console.log(`- Type: ${props.model_type}`);
        console.log(`- Input size: ${props.input_frame_size}`);
    }

    getProperties() {
        if (!classifierInitialized) throw new Error('Module is not initialized');
        return this._convertToOrdinaryJsObject(Module.get_properties(), Module.emcc_classification_properties_t.prototype);
    }

    _convertToOrdinaryJsObject(emboundObj, prototype) {
        let newObj = { };
        for (const key of Object.getOwnPropertyNames(prototype)) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
            if (descriptor && typeof descriptor.get === 'function') {
                newObj[key] = emboundObj[key];
            }
        }
        return newObj;
    }


    _arrayToHeap(data) {
        let typedArray = new Float32Array(data);
        let numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        let ptr = Module._malloc(numBytes);
        let heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return { ptr: ptr, buffer: heapBytes };
    }

    _fillResultStruct(ret) {
        const props = this.getProperties();
        const jsResult = {
            anomaly: ret.anomaly,
            results: []
        };

        for (let cx = 0; cx < ret.size(); cx++) {
            const c = ret.get(cx);
            if (props.model_type === 'object_detection' || props.model_type === 'constrained_object_detection') {
                jsResult.results.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
            } else {
                jsResult.results.push({ label: c.label, value: c.value });
            }
            c.delete();
        }

        ret.delete();
        return jsResult;
    }

    classify(rawData, debug = false) {
        if (!classifierInitialized) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);
        const ret = Module.run_classifier(obj.ptr, rawData.length, debug);
        Module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        return this._fillResultStruct(ret);
    }
}


const classifier = new EdgeImpulseClassifier();

module.exports = {
    classifier
};
