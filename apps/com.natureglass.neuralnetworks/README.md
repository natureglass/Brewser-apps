# Neural Networks

_v1.0.1_

**Neural Networks** is a live handwriting classifier that runs a real convolutional neural network right in the browser. Draw a digit from 0 to 9 and the model instantly guesses what it is, showing its confidence and a probability bar for every possible digit — and no data ever leaves your device.

 **How it works.** The app is a working demonstration of *WebNN*, a browser standard for running machine-learning models with hardware acceleration. It builds a small network — two convolution-and-pooling stages followed by a classification layer and a softmax — and loads the pre-trained weights that were learned from the classic MNIST handwriting dataset. If your browser supports WebNN it runs the network on the native engine (potentially on the GPU or a neural accelerator); if not, it transparently falls back to a built-in pure-JavaScript engine that computes the exact same math, so it always works. When you finish a stroke, the app cleans up your drawing the same way the training data was prepared: it finds the ink, crops and scales it, and re-centres it by its centre of mass into a small 28×28 grid before feeding it to the network. The ten output scores are ranked, and the winner becomes the prediction.

 **How you interact:**

 - **Draw** — sketch a digit on the pad (touch and mouse both work); it classifies automatically when you lift your finger.
- **Clear** — wipes the pad to start a new doodle.
- **Benchmark** — runs the network many times in a row and reports the average and fastest inference time.
- **Status readouts** — chips show which engine is active (turning amber when running on the JavaScript fallback rather than native WebNN), the device, and the last run's timing.

 A compact, framework-free look at in-browser neural networks that works fully offline once loaded.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)
