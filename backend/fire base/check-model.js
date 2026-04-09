const Module = require('./pasindukaushalya-project-1-wasm-v4-impulse-#5/node/edge-impulse-standalone');
const fs = require('fs');

let classifierInitialized = false;
class EdgeImpulseClassifier {
    _initialized = false;

    init() {
        if (classifierInitialized === true) return Promise.resolve();

        return new Promise((resolve, reject) => {
            Module.onRuntimeInitialized = () => {
                classifierInitialized = true;
                let ret = Module.init();
                if (typeof ret === 'number' && ret != 0) {
                    return reject('init() failed with code ' + ret);
                }
                resolve();
            };
        });
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
                newObj[key] = emboundObj[key]; // Evaluates the getter and assigns as an own property.
            }
        }
        return newObj;
    }
}

let classifier = new EdgeImpulseClassifier();
classifier.init().then(() => {
    console.log(classifier.getProperties());
});
