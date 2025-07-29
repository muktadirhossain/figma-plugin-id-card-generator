"use strict";
// code.ts - Main plugin logic
figma.showUI(__html__, {
    width: 400,
    height: 600,
    themeColors: true,
});
let csvData = [];
let templates = [];
let uploadedImages = new Map();
let isGenerating = false;
function logCurrentState() {
    console.log("Current state:", {
        templatesCount: templates.length,
        csvDataCount: csvData.length,
        isGenerating,
    });
}
figma.ui.onmessage = async (msg) => {
    var _a;
    try {
        switch (msg.type) {
            case "scan-templates":
                await scanTemplates();
                break;
            case "upload-images":
                console.log("Processing uploaded images:", ((_a = msg.images) === null || _a === void 0 ? void 0 : _a.length) || 0);
                uploadedImages.clear();
                if (msg.images && Array.isArray(msg.images)) {
                    for (const imageData of msg.images) {
                        if (imageData.name && imageData.data) {
                            const uint8Array = new Uint8Array(imageData.data);
                            uploadedImages.set(imageData.name, uint8Array);
                            console.log(`Stored image: ${imageData.name} (${uint8Array.length} bytes)`);
                        }
                    }
                }
                figma.ui.postMessage({
                    type: "images-uploaded",
                    count: uploadedImages.size,
                    imageNames: Array.from(uploadedImages.keys()),
                });
                break;
            case "process-csv":
                console.log("Processing CSV - raw message:", msg);
                console.log("CSV data type:", typeof msg.data);
                console.log("CSV data is array:", Array.isArray(msg.data));
                if (!msg.data) {
                    console.error("No data property in message");
                    figma.ui.postMessage({
                        type: "error",
                        message: "No CSV data received",
                    });
                    return;
                }
                if (!Array.isArray(msg.data)) {
                    console.error("CSV data is not an array:", msg.data);
                    figma.ui.postMessage({
                        type: "error",
                        message: "Invalid CSV data format - expected array",
                    });
                    return;
                }
                csvData = msg.data;
                console.log("CSV data successfully stored:", csvData.length, "rows");
                if (csvData.length > 0) {
                    console.log("First CSV row:", csvData[0]);
                    console.log("CSV headers:", Object.keys(csvData[0]));
                }
                figma.ui.postMessage({
                    type: "csv-processed",
                    data: csvData,
                    rowCount: csvData.length,
                    headers: csvData.length > 0 ? Object.keys(csvData[0]) : [],
                });
                break;
            case "generate-cards":
                console.log("Generate cards requested");
                logCurrentState();
                if (!isGenerating) {
                    await generateIDCards(msg.options);
                }
                break;
            case "check-state":
                logCurrentState();
                figma.ui.postMessage({
                    type: "state-info",
                    templates: templates.length,
                    csvRows: csvData.length,
                    imagesCount: uploadedImages.size,
                    templateNames: templates.map((t) => t.node.name),
                    csvSample: csvData.length > 0 ? csvData[0] : null,
                    imageNames: Array.from(uploadedImages.keys()),
                });
                break;
            case "cancel-generation":
                isGenerating = false;
                break;
        }
    }
    catch (error) {
        figma.ui.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : "An unknown error occurred",
        });
    }
};
async function scanTemplates() {
    templates = [];
    const currentPage = figma.currentPage; // Fixed: Use synchronous property instead of async method
    const selection = currentPage.selection;
    if (selection.length === 0) {
        figma.ui.postMessage({
            type: "error",
            message: "Please select template frames first",
        });
        return;
    }
    for (const node of selection) {
        if (node.type === "FRAME") {
            const frameName = node.name.toLowerCase();
            let templateType = "front";
            if (frameName.includes("back") || frameName.includes("rear")) {
                templateType = "back";
            }
            templates.push({
                node: node,
                type: templateType,
            });
        }
    }
    if (templates.length === 0) {
        figma.ui.postMessage({
            type: "error",
            message: "No valid frame templates found in selection",
        });
        return;
    }
    const layerNames = new Set();
    for (const template of templates) {
        extractLayerNames(template.node, layerNames);
    }
    figma.ui.postMessage({
        type: "templates-scanned",
        templates: templates.map((t) => ({
            name: t.node.name,
            type: t.type,
            id: t.node.id,
        })),
        layerNames: Array.from(layerNames),
    });
    console.log("Templates scanned:", templates.length);
}
function extractLayerNames(node, layerNames) {
    if (node.type === "TEXT") {
        layerNames.add(node.name);
    }
    else if (node.type === "RECTANGLE") {
        layerNames.add(node.name);
        console.log(`Found rectangle layer: "${node.name}"`);
    }
    if ("children" in node) {
        for (const child of node.children) {
            extractLayerNames(child, layerNames);
        }
    }
}
async function generateIDCards(options) {
    console.log("generateIDCards called with:", {
        templatesLength: templates.length,
        csvDataLength: csvData.length,
        options,
    });
    if (templates.length === 0 || csvData.length === 0) {
        const errorMsg = `Templates or CSV data not ready. Templates: ${templates.length}, CSV rows: ${csvData.length}`;
        console.error(errorMsg);
        figma.ui.postMessage({
            type: "error",
            message: errorMsg,
        });
        return;
    }
    isGenerating = true;
    figma.ui.postMessage({
        type: "generation-started",
        totalCards: csvData.length,
    });
    try {
        const generatedPage = figma.createPage();
        generatedPage.name = `Generated ID Cards - ${new Date().toLocaleDateString()}`;
        await figma.setCurrentPageAsync(generatedPage);
        const frontTemplate = templates.find((t) => t.type === "front");
        const backTemplate = templates.find((t) => t.type === "back");
        let currentRow = 0;
        let currentCol = 0;
        let frontRowY = 0;
        let backRowY = 0;
        for (let i = 0; i < csvData.length; i++) {
            if (!isGenerating) {
                figma.ui.postMessage({
                    type: "generation-cancelled",
                });
                return;
            }
            const rowData = csvData[i];
            if (frontTemplate) {
                const frontCard = await generateSingleCard(frontTemplate.node, rowData, "front", i + 1, options.imageScaling, options.textResize);
                const x = currentCol * (frontTemplate.node.width + options.spacing);
                const y = frontRowY;
                frontCard.x = x;
                frontCard.y = y;
                generatedPage.appendChild(frontCard);
            }
            if (backTemplate) {
                const backCard = await generateSingleCard(backTemplate.node, rowData, "back", i + 1, options.imageScaling, options.textResize);
                const frontWidth = frontTemplate ? frontTemplate.node.width : 0;
                const totalFrontWidth = options.cardsPerRow * (frontWidth + options.spacing);
                const x = totalFrontWidth +
                    100 +
                    currentCol * (backTemplate.node.width + options.spacing);
                const y = backRowY;
                backCard.x = x;
                backCard.y = y;
                generatedPage.appendChild(backCard);
            }
            currentCol++;
            if (currentCol >= options.cardsPerRow) {
                currentCol = 0;
                const frontHeight = frontTemplate ? frontTemplate.node.height : 0;
                const backHeight = backTemplate ? backTemplate.node.height : 0;
                const maxHeight = Math.max(frontHeight, backHeight);
                frontRowY += maxHeight + options.spacing;
                backRowY += maxHeight + options.spacing;
            }
            const currentCardName = `${rowData["id"] || rowData["ID"] || i + 1}-${rowData["username"] ||
                rowData["name"] ||
                rowData["Name"] ||
                `user${i + 1}`}`;
            figma.ui.postMessage({
                type: "generation-progress",
                current: i + 1,
                total: csvData.length,
                percentage: Math.round(((i + 1) / csvData.length) * 100),
                currentCard: currentCardName,
            });
            if (i % 10 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
        }
        figma.ui.postMessage({
            type: "generation-completed",
            totalGenerated: csvData.length,
        });
    }
    catch (error) {
        figma.ui.postMessage({
            type: "error",
            message: `Generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
    }
    finally {
        isGenerating = false;
    }
}
async function generateSingleCard(template, data, type, cardNumber, imageScaling, textResizeOptions) {
    const id = data["id"] || data["ID"] || cardNumber.toString();
    const username = data["username"] || data["name"] || data["Name"] || `user${cardNumber}`;
    const filename = `${id}-${username}-${type}`;
    const card = template.clone();
    card.name = filename;
    await populateCardData(card, data, imageScaling, textResizeOptions);
    return card;
}
async function populateCardData(node, data, imageScaling = "FILL", textResizeOptions) {
    if (node.type === "TEXT") {
        const textNode = node;
        const layerName = textNode.name;
        if (data.hasOwnProperty(layerName)) {
            try {
                const fontName = textNode.fontName;
                if (fontName && typeof fontName === "object") {
                    await figma.loadFontAsync(fontName);
                }
                const newText = data[layerName] || "";
                textNode.characters = newText;
                if (layerName.toLowerCase() === "name") {
                    await handleNameField(textNode, textResizeOptions);
                }
                else if (textResizeOptions.enabled) {
                    await autoResizeText(textNode, textResizeOptions);
                }
            }
            catch (fontError) {
                console.warn(`Failed to load font for ${layerName}:`, fontError);
                textNode.characters = data[layerName] || "";
            }
        }
    }
    else if (node.type === "RECTANGLE") {
        const rectNode = node;
        const layerName = rectNode.name;
        console.log(`Processing rectangle: "${layerName}"`);
        console.log(`Available CSV columns:`, Object.keys(data));
        console.log(`Looking for column: "${layerName}"`);
        if (data.hasOwnProperty(layerName)) {
            const imageReference = data[layerName];
            console.log(`Found image reference for "${layerName}": ${imageReference}`);
            if (imageReference && imageReference.trim() !== "") {
                const imageData = uploadedImages.get(imageReference);
                if (imageData) {
                    try {
                        console.log(`Loading uploaded image: ${imageReference}`);
                        await loadImageFromData(rectNode, imageData, imageScaling);
                        return;
                    }
                    catch (error) {
                        console.warn(`Failed to load uploaded image ${imageReference}:`, error);
                    }
                }
                if (imageReference.startsWith("http://") ||
                    imageReference.startsWith("https://") ||
                    imageReference.startsWith("data:")) {
                    try {
                        console.log(`Attempting to load image from URL: ${imageReference}`);
                        await loadImageFromUrl(rectNode, imageReference, imageScaling);
                        return;
                    }
                    catch (error) {
                        console.warn(`Failed to load image from URL ${imageReference}:`, error);
                    }
                }
                console.warn(`Could not load image "${imageReference}" - not found in uploads and not a valid URL`);
                createImagePlaceholder(rectNode, `Image not found: ${imageReference}`);
            }
            else {
                console.log(`Empty image reference for ${layerName}`);
                createImagePlaceholder(rectNode, "No image specified");
            }
        }
        else {
            console.log(`No matching CSV column found for rectangle "${layerName}"`);
        }
    }
    if ("children" in node) {
        for (const child of node.children) {
            await populateCardData(child, data, imageScaling, textResizeOptions);
        }
    }
}
async function handleNameField(textNode, options) {
    try {
        const originalText = textNode.characters;
        const containerWidth = textNode.width;
        const containerHeight = textNode.height;
        const originalWidth = containerWidth;
        const originalHeight = containerHeight;
        const originalX = textNode.x;
        const originalY = textNode.y;
        const originalTextAlignHorizontal = textNode.textAlignHorizontal;
        const originalTextAlignVertical = textNode.textAlignVertical;
        const originalAutoResize = textNode.textAutoResize;
        const originalLineHeight = textNode.lineHeight;
        const isInAutoLayout = textNode.parent &&
            textNode.parent.type === "FRAME" &&
            textNode.parent.layoutMode !== "NONE";
        const fontName = textNode.fontName;
        if (fontName && typeof fontName === "object") {
            await figma.loadFontAsync(fontName);
        }
        const tempTextNode = textNode.clone();
        tempTextNode.textAutoResize = "WIDTH_AND_HEIGHT";
        tempTextNode.characters = originalText;
        if (textNode.parent && "appendChild" in textNode.parent) {
            textNode.parent.appendChild(tempTextNode);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        const actualTextWidth = tempTextNode.width;
        const actualTextHeight = tempTextNode.height;
        console.log(`Name field: "${originalText}" - Container: ${containerWidth}x${containerHeight}, Actual: ${actualTextWidth}x${actualTextHeight}`);
        const overflowsWidth = actualTextWidth > containerWidth;
        const overflowsHeight = actualTextHeight > containerHeight;
        if (overflowsWidth || overflowsHeight) {
            console.log(`Name field overflow detected, converting to two lines: "${originalText}"`);
            const multiLineText = convertNameToTwoLines(originalText);
            tempTextNode.characters = multiLineText;
            if (typeof originalLineHeight === "object" &&
                "unit" in originalLineHeight) {
                if (originalLineHeight.unit === "PERCENT") {
                    tempTextNode.lineHeight = {
                        value: Math.max(100, originalLineHeight.value * 0.9),
                        unit: "PERCENT",
                    };
                }
                else if (originalLineHeight.unit === "PIXELS") {
                    const lineHeight = originalLineHeight;
                    const currentFontSize = textNode.fontSize;
                    tempTextNode.lineHeight = {
                        value: Math.max(currentFontSize, lineHeight.value * 0.9),
                        unit: "PIXELS",
                    };
                }
            }
            else {
                const currentFontSize = textNode.fontSize;
                tempTextNode.lineHeight = {
                    value: currentFontSize * 1.1,
                    unit: "PIXELS",
                };
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
            if (tempTextNode.width <= containerWidth &&
                tempTextNode.height <= containerHeight) {
                console.log(`Two-line name fits! Applying: "${multiLineText}"`);
                textNode.characters = multiLineText;
                if (tempTextNode.lineHeight &&
                    typeof tempTextNode.lineHeight === "object") {
                    textNode.lineHeight = tempTextNode.lineHeight;
                }
                if (isInAutoLayout) {
                    textNode.textAlignHorizontal = originalTextAlignHorizontal;
                    textNode.textAlignVertical = originalTextAlignVertical;
                    if (originalAutoResize === "HEIGHT") {
                        textNode.textAutoResize = "HEIGHT";
                    }
                    else if (originalAutoResize === "NONE") {
                        textNode.textAutoResize = "NONE";
                        textNode.resize(originalWidth, originalHeight);
                    }
                }
                else {
                    textNode.textAutoResize = originalAutoResize;
                    textNode.resize(originalWidth, originalHeight);
                    textNode.x = originalX;
                    textNode.y = originalY;
                    textNode.textAlignHorizontal = originalTextAlignHorizontal;
                    textNode.textAlignVertical = originalTextAlignVertical;
                }
                console.log(`Successfully applied two-line format for name: "${multiLineText}"`);
            }
            else {
                console.log(`Two-line name still doesn't fit, keeping original format: "${originalText}"`);
                textNode.characters = originalText;
            }
        }
        else {
            console.log(`Name field fits in single line: "${originalText}"`);
        }
        if (tempTextNode.parent) {
            tempTextNode.remove();
        }
    }
    catch (error) {
        console.warn(`Name field handling failed for "${textNode.characters}":`, error);
        try {
            textNode.characters = textNode.characters;
        }
        catch (restoreError) {
            console.warn("Failed to restore name field state:", restoreError);
        }
    }
}
function convertNameToTwoLines(text) {
    const words = text.trim().split(/\s+/);
    if (words.length <= 1) {
        return text;
    }
    if (words.length === 2) {
        return words.join("\n");
    }
    if (words.length >= 3) {
        const totalLength = text.length;
        const targetLength = Math.ceil(totalLength / 2);
        let firstLine = "";
        let secondLine = "";
        let currentLength = 0;
        let splitIndex = 0;
        for (let i = 0; i < words.length; i++) {
            const wordLength = words[i].length + (i > 0 ? 1 : 0);
            if (currentLength + wordLength <= targetLength || i === 0) {
                currentLength += wordLength;
                splitIndex = i;
            }
            else {
                break;
            }
        }
        if (splitIndex >= words.length - 1) {
            splitIndex = Math.floor(words.length / 2) - 1;
        }
        firstLine = words.slice(0, splitIndex + 1).join(" ");
        secondLine = words.slice(splitIndex + 1).join(" ");
        return firstLine + "\n" + secondLine;
    }
    return text;
}
async function autoResizeText(textNode, options) {
    try {
        const originalFontSize = textNode.fontSize;
        const containerWidth = textNode.width;
        const containerHeight = textNode.height;
        const originalWidth = containerWidth;
        const originalHeight = containerHeight;
        const originalX = textNode.x;
        const originalY = textNode.y;
        const originalTextAlignHorizontal = textNode.textAlignHorizontal;
        const originalTextAlignVertical = textNode.textAlignVertical;
        const originalAutoResize = textNode.textAutoResize;
        const isInAutoLayout = textNode.parent &&
            textNode.parent.type === "FRAME" &&
            textNode.parent.layoutMode !== "NONE";
        const fontName = textNode.fontName;
        if (fontName && typeof fontName === "object") {
            await figma.loadFontAsync(fontName);
        }
        const layerName = textNode.name.toLowerCase();
        const isNameField = layerName.includes("name") || layerName.includes("username");
        const textLength = textNode.characters.length;
        const tempTextNode = textNode.clone();
        tempTextNode.textAutoResize = "WIDTH_AND_HEIGHT";
        tempTextNode.fontSize = originalFontSize;
        tempTextNode.characters = textNode.characters;
        if (textNode.parent && "appendChild" in textNode.parent) {
            textNode.parent.appendChild(tempTextNode);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        const actualTextWidth = tempTextNode.width;
        const actualTextHeight = tempTextNode.height;
        console.log(`Text: "${textNode.characters}" - Container: ${containerWidth}x${containerHeight}, Actual: ${actualTextWidth}x${actualTextHeight}`);
        const overflowsWidth = actualTextWidth > containerWidth;
        const overflowsHeight = actualTextHeight > containerHeight;
        if (overflowsWidth || overflowsHeight) {
            console.log(`Text overflow detected for "${textNode.characters}"`);
            if (isNameField && overflowsWidth && textLength > options.nameThreshold) {
                console.log(`Attempting to convert long name to multi-line: "${textNode.characters}"`);
                const multiLineText = convertToMultiLine(textNode.characters);
                tempTextNode.characters = multiLineText;
                const currentLineHeight = tempTextNode.lineHeight;
                if (typeof currentLineHeight === "object" &&
                    "unit" in currentLineHeight) {
                    if (currentLineHeight.unit === "PERCENT") {
                        tempTextNode.lineHeight = {
                            value: Math.max(100, currentLineHeight.value * 0.85),
                            unit: "PERCENT",
                        };
                    }
                    else if (currentLineHeight.unit === "PIXELS") {
                        const lineHeight = currentLineHeight;
                        tempTextNode.lineHeight = {
                            value: Math.max(originalFontSize, lineHeight.value * 0.85),
                            unit: "PIXELS",
                        };
                    }
                }
                else {
                    tempTextNode.lineHeight = {
                        value: Math.max(originalFontSize * 1.1, 12),
                        unit: "PIXELS",
                    };
                }
                await new Promise((resolve) => setTimeout(resolve, 10));
                if (tempTextNode.width <= containerWidth &&
                    tempTextNode.height <= containerHeight) {
                    console.log(`Multi-line name fits! Applying: "${multiLineText}"`);
                    textNode.characters = multiLineText;
                    if (tempTextNode.lineHeight &&
                        typeof tempTextNode.lineHeight === "object") {
                        textNode.lineHeight = tempTextNode.lineHeight;
                    }
                    if (isInAutoLayout) {
                        textNode.textAlignHorizontal = originalTextAlignHorizontal;
                        textNode.textAlignVertical = originalTextAlignVertical;
                        if (originalAutoResize === "HEIGHT") {
                            textNode.textAutoResize = "HEIGHT";
                        }
                        else if (originalAutoResize === "NONE") {
                            textNode.textAutoResize = "NONE";
                            textNode.resize(originalWidth, originalHeight);
                        }
                    }
                    else {
                        textNode.textAutoResize = originalAutoResize;
                        textNode.resize(originalWidth, originalHeight);
                        textNode.x = originalX;
                        textNode.y = originalY;
                        textNode.textAlignHorizontal = originalTextAlignHorizontal;
                        textNode.textAlignVertical = originalTextAlignVertical;
                    }
                    if (tempTextNode.parent) {
                        tempTextNode.remove();
                    }
                    return;
                }
                else {
                    console.log(`Multi-line name still doesn't fit, reverting to original text`);
                    tempTextNode.characters = textNode.characters;
                    if (typeof currentLineHeight === "object") {
                        tempTextNode.lineHeight = currentLineHeight;
                    }
                }
            }
            const widthScale = overflowsWidth ? containerWidth / actualTextWidth : 1;
            const heightScale = overflowsHeight
                ? containerHeight / actualTextHeight
                : 1;
            const scaleFactor = Math.min(widthScale, heightScale);
            const safetyMargin = 1 - options.safetyMargin;
            let newFontSize = Math.floor(originalFontSize * scaleFactor * safetyMargin);
            let minFontSize = options.minFontSize;
            if (isNameField) {
                if (textLength > options.nameThreshold * 1.5)
                    minFontSize = Math.max(options.minFontSize, 9);
                else if (textLength > options.nameThreshold)
                    minFontSize = Math.max(options.minFontSize, 10);
                else
                    minFontSize = Math.max(options.minFontSize, 11);
            }
            else if (layerName.includes("address") ||
                layerName.includes("location")) {
                if (textLength > options.addressThreshold * 1.5)
                    minFontSize = options.minFontSize;
                else if (textLength > options.addressThreshold)
                    minFontSize = Math.max(options.minFontSize, 7);
                else
                    minFontSize = Math.max(options.minFontSize, 8);
            }
            else if (layerName.includes("title") ||
                layerName.includes("position") ||
                layerName.includes("designation")) {
                if (textLength > 25)
                    minFontSize = Math.max(options.minFontSize, 8);
                else
                    minFontSize = Math.max(options.minFontSize, 10);
            }
            else if (layerName.includes("id") ||
                layerName.includes("number") ||
                layerName.includes("roll") ||
                layerName.includes("student_id")) {
                minFontSize = Math.max(options.minFontSize, 9);
            }
            else if (layerName.includes("class") ||
                layerName.includes("grade") ||
                layerName.includes("section")) {
                minFontSize = Math.max(options.minFontSize, 8);
            }
            else {
                if (textLength > 40)
                    minFontSize = options.minFontSize;
                else if (textLength > 20)
                    minFontSize = Math.max(options.minFontSize, 8);
                else
                    minFontSize = Math.max(options.minFontSize, 9);
            }
            newFontSize = Math.max(minFontSize, newFontSize);
            console.log(`Resizing font from ${originalFontSize}px to ${newFontSize}px (min: ${minFontSize}px) for "${layerName}"`);
            tempTextNode.fontSize = newFontSize;
            await new Promise((resolve) => setTimeout(resolve, 10));
            if (tempTextNode.width > containerWidth ||
                tempTextNode.height > containerHeight) {
                if (tempTextNode.lineHeight &&
                    typeof tempTextNode.lineHeight === "object" &&
                    "unit" in tempTextNode.lineHeight &&
                    tempTextNode.lineHeight.unit === "PIXELS") {
                    const lineHeight = tempTextNode.lineHeight;
                    const newLineHeight = Math.max(newFontSize * 1.1, lineHeight.value * 0.9);
                    tempTextNode.lineHeight = { value: newLineHeight, unit: "PIXELS" };
                }
                else if (tempTextNode.lineHeight &&
                    typeof tempTextNode.lineHeight === "object" &&
                    "unit" in tempTextNode.lineHeight &&
                    tempTextNode.lineHeight.unit === "PERCENT") {
                    const lineHeight = tempTextNode.lineHeight;
                    tempTextNode.lineHeight = {
                        value: Math.max(100, lineHeight.value * 0.9),
                        unit: "PERCENT",
                    };
                }
                await new Promise((resolve) => setTimeout(resolve, 10));
                if ((tempTextNode.width > containerWidth ||
                    tempTextNode.height > containerHeight) &&
                    newFontSize > options.minFontSize) {
                    newFontSize = Math.max(options.minFontSize, newFontSize - 1);
                    tempTextNode.fontSize = newFontSize;
                    console.log(`Final font size adjustment to ${newFontSize}px for "${layerName}"`);
                }
            }
            textNode.fontSize = newFontSize;
            if (tempTextNode.lineHeight &&
                typeof tempTextNode.lineHeight === "object") {
                textNode.lineHeight = tempTextNode.lineHeight;
            }
            if (isInAutoLayout) {
                textNode.textAlignHorizontal = originalTextAlignHorizontal;
                textNode.textAlignVertical = originalTextAlignVertical;
                if (originalAutoResize === "HEIGHT") {
                    textNode.textAutoResize = "HEIGHT";
                }
                else if (originalAutoResize === "NONE") {
                    textNode.textAutoResize = "NONE";
                    textNode.resize(originalWidth, originalHeight);
                }
            }
            else {
                textNode.textAutoResize = originalAutoResize;
                textNode.resize(originalWidth, originalHeight);
                textNode.x = originalX;
                textNode.y = originalY;
                textNode.textAlignHorizontal = originalTextAlignHorizontal;
                textNode.textAlignVertical = originalTextAlignVertical;
            }
        }
        if (tempTextNode.parent) {
            tempTextNode.remove();
        }
    }
    catch (error) {
        console.warn(`Auto-resize failed for "${textNode.characters}":`, error);
        try {
            const originalFontSize = textNode.fontSize;
            const originalWidth = textNode.width;
            const originalHeight = textNode.height;
            const originalX = textNode.x;
            const originalY = textNode.y;
            const originalTextAlignHorizontal = textNode.textAlignHorizontal;
            const originalTextAlignVertical = textNode.textAlignVertical;
            const originalAutoResize = textNode.textAutoResize;
            const isInAutoLayout = textNode.parent &&
                textNode.parent.type === "FRAME" &&
                textNode.parent.layoutMode !== "NONE";
            textNode.textAutoResize = originalAutoResize || "NONE";
            textNode.fontSize = originalFontSize;
            if (!isInAutoLayout) {
                textNode.resize(originalWidth, originalHeight);
                textNode.x = originalX;
                textNode.y = originalY;
            }
            textNode.textAlignHorizontal = originalTextAlignHorizontal;
            textNode.textAlignVertical = originalTextAlignVertical;
        }
        catch (restoreError) {
            console.warn("Failed to restore text state:", restoreError);
        }
    }
}
function convertToMultiLine(text) {
    const words = text.trim().split(/\s+/);
    if (words.length <= 1) {
        return text;
    }
    if (words.length === 2) {
        return words.join("\n");
    }
    if (words.length >= 3) {
        const totalLength = text.length;
        const targetLength = Math.ceil(totalLength / 2);
        let firstLine = "";
        let secondLine = "";
        let currentLength = 0;
        let splitIndex = 0;
        for (let i = 0; i < words.length; i++) {
            const wordLength = words[i].length + (i > 0 ? 1 : 0);
            if (currentLength + wordLength <= targetLength || i === 0) {
                currentLength += wordLength;
                splitIndex = i;
            }
            else {
                break;
            }
        }
        if (splitIndex >= words.length - 1) {
            splitIndex = Math.floor(words.length / 2) - 1;
        }
        firstLine = words.slice(0, splitIndex + 1).join(" ");
        secondLine = words.slice(splitIndex + 1).join(" ");
        return firstLine + "\n" + secondLine;
    }
    return text;
}
async function loadImageFromData(rectNode, imageData, imageScaling = "FILL") {
    try {
        console.log(`Loading image from uploaded data, size: ${imageData.length} bytes`);
        console.log(`Rectangle dimensions: ${rectNode.width}x${rectNode.height}`);
        const image = figma.createImage(imageData);
        console.log(`Image created with hash: ${image.hash}`);
        rectNode.fills = [];
        const newFills = [
            {
                type: "IMAGE",
                imageHash: image.hash,
                scaleMode: imageScaling,
                scalingFactor: 1,
            },
        ];
        rectNode.fills = newFills;
        console.log(`Successfully applied uploaded image to rectangle "${rectNode.name}" with scale mode: ${imageScaling}`);
    }
    catch (error) {
        console.error(`Failed to load image from data:`, error);
        createImagePlaceholder(rectNode, "Failed to load uploaded image");
        throw error;
    }
}
async function loadImageFromUrl(rectNode, imageUrl, imageScaling = "FILL") {
    try {
        console.log(`Loading image from URL: ${imageUrl}`);
        console.log(`Rectangle dimensions: ${rectNode.width}x${rectNode.height}`);
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        console.log(`Image data size: ${arrayBuffer.byteLength} bytes`);
        if (arrayBuffer.byteLength === 0) {
            throw new Error("Empty image data received");
        }
        const uint8Array = new Uint8Array(arrayBuffer);
        const image = figma.createImage(uint8Array);
        console.log(`Image created with hash: ${image.hash}`);
        rectNode.fills = [];
        const newFills = [
            {
                type: "IMAGE",
                imageHash: image.hash,
                scaleMode: imageScaling,
                scalingFactor: 1,
            },
        ];
        rectNode.fills = newFills;
        console.log(`Successfully applied image to rectangle "${rectNode.name}" with scale mode: ${imageScaling}`);
    }
    catch (error) {
        console.error(`Failed to load image from ${imageUrl}:`, error);
        createImagePlaceholder(rectNode, `Failed to load: ${imageUrl.substring(0, 30)}...`);
        throw error;
    }
}
function createImagePlaceholder(rectNode, message) {
    const fills = [
        {
            type: "SOLID",
            color: { r: 0.95, g: 0.95, b: 0.95 },
        },
    ];
    rectNode.fills = fills;
    try {
        const textNode = figma.createText();
        figma
            .loadFontAsync({ family: "Inter", style: "Regular" })
            .catch(() => {
            return figma.loadFontAsync({ family: "Roboto", style: "Regular" });
        })
            .then(() => {
            textNode.characters = message;
            textNode.fontSize = Math.min(8, rectNode.width / 20);
            textNode.textAlignHorizontal = "CENTER";
            textNode.textAlignVertical = "CENTER";
            textNode.resize(rectNode.width - 8, rectNode.height - 8);
            textNode.x = rectNode.x + 4;
            textNode.y = rectNode.y + 4;
            const textFills = [
                {
                    type: "SOLID",
                    color: { r: 0.6, g: 0.6, b: 0.6 },
                },
            ];
            textNode.fills = textFills;
            if (rectNode.parent && "appendChild" in rectNode.parent) {
                rectNode.parent.appendChild(textNode);
            }
        })
            .catch((error) => {
            console.warn("Failed to create placeholder text:", error);
        });
    }
    catch (textError) {
        console.warn("Failed to create placeholder text:", textError);
    }
}
figma.ui.postMessage({ type: "plugin-ready" });
