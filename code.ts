// code.ts - Main plugin logic
figma.showUI(__html__, {
  width: 400,
  height: 600,
  themeColors: true
});

interface CSVRow {
  [key: string]: string;
}

interface TemplateInfo {
  node: FrameNode;
  type: 'front' | 'back';
}

interface TextResizeOptions {
  enabled: boolean;
  minFontSize: number;
  safetyMargin: number;
  nameThreshold: number;
  addressThreshold: number;
}

interface ImageData {
  name: string;
  data: Uint8Array;
}

let csvData: CSVRow[] = [];
let templates: TemplateInfo[] = [];
let uploadedImages: Map<string, Uint8Array> = new Map();
let isGenerating = false;

// Debug function to check state
function logCurrentState() {
  console.log('Current state:', {
    templatesCount: templates.length,
    csvDataCount: csvData.length,
    isGenerating
  });
}

// Listen for messages from UI
figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {
      case 'scan-templates':
        await scanTemplates();
        break;
      
      case 'upload-images':
        console.log('Processing uploaded images:', msg.images?.length || 0);
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
          type: 'images-uploaded',
          count: uploadedImages.size,
          imageNames: Array.from(uploadedImages.keys())
        });
        break;
      
      case 'process-csv':
        console.log('Processing CSV - raw message:', msg);
        console.log('CSV data type:', typeof msg.data);
        console.log('CSV data is array:', Array.isArray(msg.data));
        
        if (!msg.data) {
          console.error('No data property in message');
          figma.ui.postMessage({
            type: 'error',
            message: 'No CSV data received'
          });
          return;
        }
        
        if (!Array.isArray(msg.data)) {
          console.error('CSV data is not an array:', msg.data);
          figma.ui.postMessage({
            type: 'error',
            message: 'Invalid CSV data format - expected array'
          });
          return;
        }
        
        csvData = msg.data;
        console.log('CSV data successfully stored:', csvData.length, 'rows');
        
        if (csvData.length > 0) {
          console.log('First CSV row:', csvData[0]);
          console.log('CSV headers:', Object.keys(csvData[0]));
        }
        
        figma.ui.postMessage({
          type: 'csv-processed',
          data: csvData, // Send data back to UI for verification
          rowCount: csvData.length,
          headers: csvData.length > 0 ? Object.keys(csvData[0]) : []
        });
        break;
      
      case 'generate-cards':
        console.log('Generate cards requested');
        logCurrentState();
        if (!isGenerating) {
          await generateIDCards(msg.options);
        }
        break;
      
      case 'check-state':
        logCurrentState();
        figma.ui.postMessage({
          type: 'state-info',
          templates: templates.length,
          csvRows: csvData.length,
          imagesCount: uploadedImages.size,
          templateNames: templates.map(t => t.node.name),
          csvSample: csvData.length > 0 ? csvData[0] : null,
          imageNames: Array.from(uploadedImages.keys())
        });
        break;
      
      case 'cancel-generation':
        isGenerating = false;
        break;
    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    });
  }
};

async function scanTemplates() {
  templates = [];
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Please select template frames first'
    });
    return;
  }

  for (const node of selection) {
    if (node.type === 'FRAME') {
      const frameName = node.name.toLowerCase();
      let templateType: 'front' | 'back' = 'front';
      
      if (frameName.includes('back') || frameName.includes('rear')) {
        templateType = 'back';
      }
      
      templates.push({
        node: node as FrameNode,
        type: templateType
      });
    }
  }

  if (templates.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'No valid frame templates found in selection'
    });
    return;
  }

  // Get layer names from templates for mapping
  const layerNames = new Set<string>();
  
  for (const template of templates) {
    extractLayerNames(template.node, layerNames);
  }

  figma.ui.postMessage({
    type: 'templates-scanned',
    templates: templates.map(t => ({
      name: t.node.name,
      type: t.type,
      id: t.node.id
    })),
    layerNames: Array.from(layerNames)
  });
  
  console.log('Templates scanned:', templates.length);
}

function extractLayerNames(node: SceneNode, layerNames: Set<string>) {
  if (node.type === 'TEXT') {
    layerNames.add(node.name);
  } else if (node.type === 'RECTANGLE') {
    // Always add rectangle names as potential image placeholders
    // This will help identify all rectangles that could be used for images
    layerNames.add(node.name);
    console.log(`Found rectangle layer: "${node.name}"`);
  }
  
  if ('children' in node) {
    for (const child of node.children) {
      extractLayerNames(child, layerNames);
    }
  }
}

async function generateIDCards(options: { 
  spacing: number; 
  cardsPerRow: number; 
  imageScaling: string;
  textResize: TextResizeOptions;
}) {
  console.log('generateIDCards called with:', { 
    templatesLength: templates.length, 
    csvDataLength: csvData.length,
    options 
  });

  if (templates.length === 0 || csvData.length === 0) {
    const errorMsg = `Templates or CSV data not ready. Templates: ${templates.length}, CSV rows: ${csvData.length}`;
    console.error(errorMsg);
    figma.ui.postMessage({
      type: 'error',
      message: errorMsg
    });
    return;
  }

  isGenerating = true;
  
  figma.ui.postMessage({
    type: 'generation-started',
    totalCards: csvData.length
  });

  try {
    // Create a new page for generated cards
    const generatedPage = figma.createPage();
    generatedPage.name = `Generated ID Cards - ${new Date().toLocaleDateString()}`;
    figma.currentPage = generatedPage;

    const frontTemplate = templates.find(t => t.type === 'front');
    const backTemplate = templates.find(t => t.type === 'back');

    let currentRow = 0;
    let currentCol = 0;
    let frontRowY = 0;
    let backRowY = 0;

    for (let i = 0; i < csvData.length; i++) {
      if (!isGenerating) {
        figma.ui.postMessage({
          type: 'generation-cancelled'
        });
        return;
      }

      const rowData = csvData[i];
      
      // Generate front card
      if (frontTemplate) {
        const frontCard = await generateSingleCard(frontTemplate.node, rowData, 'front', i + 1, options.imageScaling, options.textResize);
        
        const x = currentCol * (frontTemplate.node.width + options.spacing);
        const y = frontRowY;
        
        frontCard.x = x;
        frontCard.y = y;
        
        generatedPage.appendChild(frontCard);
      }

      // Generate back card
      if (backTemplate) {
        const backCard = await generateSingleCard(backTemplate.node, rowData, 'back', i + 1, options.imageScaling, options.textResize);
        
        const frontWidth = frontTemplate ? frontTemplate.node.width : 0;
        const totalFrontWidth = options.cardsPerRow * (frontWidth + options.spacing);
        
        const x = totalFrontWidth + 100 + (currentCol * (backTemplate.node.width + options.spacing));
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

      // Update progress with more details
      const currentCardName = `${rowData['id'] || rowData['ID'] || i + 1}-${rowData['username'] || rowData['name'] || rowData['Name'] || `user${i + 1}`}`;
      figma.ui.postMessage({
        type: 'generation-progress',
        current: i + 1,
        total: csvData.length,
        percentage: Math.round(((i + 1) / csvData.length) * 100),
        currentCard: currentCardName
      });

      // Add small delay to prevent blocking
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }

    figma.ui.postMessage({
      type: 'generation-completed',
      totalGenerated: csvData.length
    });

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: `Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  } finally {
    isGenerating = false;
  }
}

async function generateSingleCard(
  template: FrameNode, 
  data: CSVRow, 
  type: string, 
  cardNumber: number, 
  imageScaling: string,
  textResizeOptions: TextResizeOptions
): Promise<FrameNode> {
  // Generate filename using id and username/name
  const id = data['id'] || data['ID'] || cardNumber.toString();
  const username = data['username'] || data['name'] || data['Name'] || `user${cardNumber}`;
  const filename = `${id}-${username}-${type}`;
  
  const card = template.clone();
  card.name = filename;
  
  await populateCardData(card, data, imageScaling, textResizeOptions);
  return card;
}

async function populateCardData(node: SceneNode, data: CSVRow, imageScaling: string = 'FILL', textResizeOptions: TextResizeOptions) {
  if (node.type === 'TEXT') {
    const textNode = node as TextNode;
    const layerName = textNode.name;
    
    if (data.hasOwnProperty(layerName)) {
      try {
        // Load font before changing text
        const fontName = textNode.fontName as FontName;
        if (fontName && typeof fontName === 'object') {
          await figma.loadFontAsync(fontName);
        }
        
        const newText = data[layerName] || '';
        textNode.characters = newText;
        
        // Special handling for name fields - always try two-line format first
        if (layerName.toLowerCase() === 'name') {
          await handleNameField(textNode, textResizeOptions);
        } else if (textResizeOptions.enabled) {
          // Auto-resize font to prevent overflow if enabled (for non-name fields)
          await autoResizeText(textNode, textResizeOptions);
        }
        
      } catch (fontError) {
        console.warn(`Failed to load font for ${layerName}:`, fontError);
        // Try to set text anyway with default font
        textNode.characters = data[layerName] || '';
      }
    }
  } else if (node.type === 'RECTANGLE') {
    const rectNode = node as RectangleNode;
    const layerName = rectNode.name;
    
    console.log(`Processing rectangle: "${layerName}"`);
    console.log(`Available CSV columns:`, Object.keys(data));
    console.log(`Looking for column: "${layerName}"`);
    
    if (data.hasOwnProperty(layerName)) {
      const imageReference = data[layerName];
      console.log(`Found image reference for "${layerName}": ${imageReference}`);
      
      if (imageReference && imageReference.trim() !== '') {
        // First try to load from uploaded images (by filename)
        const imageData = uploadedImages.get(imageReference);
        if (imageData) {
          try {
            console.log(`Loading uploaded image: ${imageReference}`);
            await loadImageFromData(rectNode, imageData, imageScaling);
            return; // Success, exit early
          } catch (error) {
            console.warn(`Failed to load uploaded image ${imageReference}:`, error);
          }
        }
        
        // If not found in uploads, try as URL
        if (imageReference.startsWith('http://') || imageReference.startsWith('https://') || imageReference.startsWith('data:')) {
          try {
            console.log(`Attempting to load image from URL: ${imageReference}`);
            await loadImageFromUrl(rectNode, imageReference, imageScaling);
            return; // Success, exit early
          } catch (error) {
            console.warn(`Failed to load image from URL ${imageReference}:`, error);
          }
        }
        
        // If we get here, neither method worked
        console.warn(`Could not load image "${imageReference}" - not found in uploads and not a valid URL`);
        createImagePlaceholder(rectNode, `Image not found: ${imageReference}`);
      } else {
        console.log(`Empty image reference for ${layerName}`);
        createImagePlaceholder(rectNode, 'No image specified');
      }
    } else {
      console.log(`No matching CSV column found for rectangle "${layerName}"`);
    }
  }
  
  if ('children' in node) {
    for (const child of node.children) {
      await populateCardData(child, data, imageScaling, textResizeOptions);
    }
  }
}

async function handleNameField(textNode: TextNode, options: TextResizeOptions) {
  try {
    const originalText = textNode.characters;
    const containerWidth = textNode.width;
    const containerHeight = textNode.height;
    
    // Store original properties
    const originalWidth = containerWidth;
    const originalHeight = containerHeight;
    const originalX = textNode.x;
    const originalY = textNode.y;
    const originalTextAlignHorizontal = textNode.textAlignHorizontal;
    const originalTextAlignVertical = textNode.textAlignVertical;
    const originalAutoResize = textNode.textAutoResize;
    const originalLineHeight = textNode.lineHeight;
    
    // Check if text is inside an auto-layout frame
    const isInAutoLayout = textNode.parent && textNode.parent.type === 'FRAME' && 
                          (textNode.parent as FrameNode).layoutMode !== 'NONE';
    
    // Load font to ensure proper measurement
    const fontName = textNode.fontName as FontName;
    if (fontName && typeof fontName === 'object') {
      await figma.loadFontAsync(fontName);
    }
    
    // Create a temporary clone to test text fitting
    const tempTextNode = textNode.clone() as TextNode;
    tempTextNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    tempTextNode.characters = originalText;
    
    // Add to same parent temporarily to get accurate measurements
    if (textNode.parent && 'appendChild' in textNode.parent) {
      (textNode.parent as BaseNode & ChildrenMixin).appendChild(tempTextNode);
    }
    
    // Wait for Figma to calculate dimensions
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    
    const actualTextWidth = tempTextNode.width;
    const actualTextHeight = tempTextNode.height;
    
    console.log(`Name field: "${originalText}" - Container: ${containerWidth}x${containerHeight}, Actual: ${actualTextWidth}x${actualTextHeight}`);
    
    // Check if text overflows
    const overflowsWidth = actualTextWidth > containerWidth;
    const overflowsHeight = actualTextHeight > containerHeight;
    
    if (overflowsWidth || overflowsHeight) {
      console.log(`Name field overflow detected, converting to two lines: "${originalText}"`);
      
      const multiLineText = convertNameToTwoLines(originalText);
      tempTextNode.characters = multiLineText;
      
      // Optimize line height for better fit
      if (typeof originalLineHeight === 'object' && 'unit' in originalLineHeight) {
        if (originalLineHeight.unit === 'PERCENT') {
          tempTextNode.lineHeight = { value: Math.max(100, originalLineHeight.value * 0.9), unit: 'PERCENT' };
        } else if (originalLineHeight.unit === 'PIXELS') {
          const lineHeight = originalLineHeight as { value: number; unit: 'PIXELS' };
          const currentFontSize = textNode.fontSize as number;
          tempTextNode.lineHeight = { value: Math.max(currentFontSize, lineHeight.value * 0.9), unit: 'PIXELS' };
        }
      } else {
        // Set a reasonable line height if none exists
        const currentFontSize = textNode.fontSize as number;
        tempTextNode.lineHeight = { value: currentFontSize * 1.1, unit: 'PIXELS' };
      }
      
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      
      // Check if multi-line version fits
      if (tempTextNode.width <= containerWidth && tempTextNode.height <= containerHeight) {
        console.log(`Two-line name fits! Applying: "${multiLineText}"`);
        
        // Apply the multi-line text to original
        textNode.characters = multiLineText;
        if (tempTextNode.lineHeight && typeof tempTextNode.lineHeight === 'object') {
          textNode.lineHeight = tempTextNode.lineHeight;
        }
        
        // Restore positioning and alignment
        if (isInAutoLayout) {
          textNode.textAlignHorizontal = originalTextAlignHorizontal;
          textNode.textAlignVertical = originalTextAlignVertical;
          if (originalAutoResize === 'HEIGHT') {
            textNode.textAutoResize = 'HEIGHT';
          } else if (originalAutoResize === 'NONE') {
            textNode.textAutoResize = 'NONE';
            textNode.resize(originalWidth, originalHeight);
          }
        } else {
          textNode.textAutoResize = originalAutoResize;
          textNode.resize(originalWidth, originalHeight);
          textNode.x = originalX;
          textNode.y = originalY;
          textNode.textAlignHorizontal = originalTextAlignHorizontal;
          textNode.textAlignVertical = originalTextAlignVertical;
        }
        
        console.log(`Successfully applied two-line format for name: "${multiLineText}"`);
      } else {
        console.log(`Two-line name still doesn't fit, keeping original format: "${originalText}"`);
        // Keep original text and format - no font size changes for name fields
        textNode.characters = originalText;
      }
    } else {
      console.log(`Name field fits in single line: "${originalText}"`);
    }
    
    // Clean up temporary node
    if (tempTextNode.parent) {
      tempTextNode.remove();
    }
    
  } catch (error) {
    console.warn(`Name field handling failed for "${textNode.characters}":`, error);
    
    // Fallback: keep original text unchanged
    try {
      textNode.characters = textNode.characters; // Ensure text stays the same
    } catch (restoreError) {
      console.warn('Failed to restore name field state:', restoreError);
    }
  }
}

// Helper function to convert names to optimal two-line format
function convertNameToTwoLines(text: string): string {
  const words = text.trim().split(/\s+/);
  
  if (words.length <= 1) {
    return text; // Can't split single word
  }
  
  // Strategy 1: If there are exactly 2 words, put each on a separate line
  if (words.length === 2) {
    return words.join('\n');
  }
  
  // Strategy 2: For 3+ words, try to balance the lines by character count
  if (words.length >= 3) {
    const totalLength = text.length;
    const targetLength = Math.ceil(totalLength / 2);
    
    let firstLine = '';
    let secondLine = '';
    let currentLength = 0;
    let splitIndex = 0;
    
    // Find the best split point to balance line lengths
    for (let i = 0; i < words.length; i++) {
      const wordLength = words[i].length + (i > 0 ? 1 : 0); // +1 for space
      
      if (currentLength + wordLength <= targetLength || i === 0) {
        currentLength += wordLength;
        splitIndex = i;
      } else {
        break;
      }
    }
    
    // Ensure we don't put all words on first line (leave at least one word for second line)
    if (splitIndex >= words.length - 1) {
      splitIndex = Math.floor(words.length / 2) - 1;
    }
    
    firstLine = words.slice(0, splitIndex + 1).join(' ');
    secondLine = words.slice(splitIndex + 1).join(' ');
    
    return firstLine + '\n' + secondLine;
  }
  
  return text; // Fallback
}

async function autoResizeText(textNode: TextNode, options: TextResizeOptions) {
  try {
    const originalFontSize = textNode.fontSize as number;
    const containerWidth = textNode.width;
    const containerHeight = textNode.height;
    
    // Store original properties to preserve alignment and positioning
    const originalWidth = containerWidth;
    const originalHeight = containerHeight;
    const originalX = textNode.x;
    const originalY = textNode.y;
    const originalTextAlignHorizontal = textNode.textAlignHorizontal;
    const originalTextAlignVertical = textNode.textAlignVertical;
    const originalAutoResize = textNode.textAutoResize;
    
    // Check if text is inside an auto-layout frame
    const isInAutoLayout = textNode.parent && textNode.parent.type === 'FRAME' && 
                          (textNode.parent as FrameNode).layoutMode !== 'NONE';
    
    // Load font to ensure proper measurement
    const fontName = textNode.fontName as FontName;
    if (fontName && typeof fontName === 'object') {
      await figma.loadFontAsync(fontName);
    }
    
    // Check if this is a name field that should be converted to multi-line
    const layerName = textNode.name.toLowerCase();
    const isNameField = layerName.includes('name') || layerName.includes('username');
    const textLength = textNode.characters.length;
    
    // Create a temporary clone to measure text without affecting the original
    const tempTextNode = textNode.clone() as TextNode;
    tempTextNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    tempTextNode.fontSize = originalFontSize;
    tempTextNode.characters = textNode.characters;
    
    // Add to same parent temporarily to get accurate measurements
    if (textNode.parent && 'appendChild' in textNode.parent) {
      (textNode.parent as BaseNode & ChildrenMixin).appendChild(tempTextNode);
    }
    
    // Wait for Figma to calculate dimensions
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    
    const actualTextWidth = tempTextNode.width;
    const actualTextHeight = tempTextNode.height;
    
    console.log(`Text: "${textNode.characters}" - Container: ${containerWidth}x${containerHeight}, Actual: ${actualTextWidth}x${actualTextHeight}`);
    
    // Check if text overflows
    const overflowsWidth = actualTextWidth > containerWidth;
    const overflowsHeight = actualTextHeight > containerHeight;
    
    if (overflowsWidth || overflowsHeight) {
      console.log(`Text overflow detected for "${textNode.characters}"`);
      
      // Special handling for name fields - try multi-line first
      if (isNameField && overflowsWidth && textLength > options.nameThreshold) {
        console.log(`Attempting to convert long name to multi-line: "${textNode.characters}"`);
        
        const multiLineText = convertToMultiLine(textNode.characters);
        tempTextNode.characters = multiLineText;
        
        // Test with reduced line height for better fit
        const currentLineHeight = tempTextNode.lineHeight;
        if (typeof currentLineHeight === 'object' && 'unit' in currentLineHeight) {
          if (currentLineHeight.unit === 'PERCENT') {
            tempTextNode.lineHeight = { value: Math.max(100, currentLineHeight.value * 0.85), unit: 'PERCENT' };
          } else if (currentLineHeight.unit === 'PIXELS') {
            const lineHeight = currentLineHeight as { value: number; unit: 'PIXELS' };
            tempTextNode.lineHeight = { value: Math.max(originalFontSize, lineHeight.value * 0.85), unit: 'PIXELS' };
          }
        } else {
          // Set a reasonable line height if none exists
          tempTextNode.lineHeight = { value: Math.max(originalFontSize * 1.1, 12), unit: 'PIXELS' };
        }
        
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        
        // Check if multi-line version fits
        if (tempTextNode.width <= containerWidth && tempTextNode.height <= containerHeight) {
          console.log(`Multi-line name fits! Applying: "${multiLineText}"`);
          
          // Apply the multi-line text to original
          textNode.characters = multiLineText;
          if (tempTextNode.lineHeight && typeof tempTextNode.lineHeight === 'object') {
            textNode.lineHeight = tempTextNode.lineHeight;
          }
          
          // Restore positioning and alignment
          if (isInAutoLayout) {
            textNode.textAlignHorizontal = originalTextAlignHorizontal;
            textNode.textAlignVertical = originalTextAlignVertical;
            if (originalAutoResize === 'HEIGHT') {
              textNode.textAutoResize = 'HEIGHT';
            } else if (originalAutoResize === 'NONE') {
              textNode.textAutoResize = 'NONE';
              textNode.resize(originalWidth, originalHeight);
            }
          } else {
            textNode.textAutoResize = originalAutoResize;
            textNode.resize(originalWidth, originalHeight);
            textNode.x = originalX;
            textNode.y = originalY;
            textNode.textAlignHorizontal = originalTextAlignHorizontal;
            textNode.textAlignVertical = originalTextAlignVertical;
          }
          
          // Clean up and return - we're done
          if (tempTextNode.parent) {
            tempTextNode.remove();
          }
          return;
        } else {
          console.log(`Multi-line name still doesn't fit, reverting to original text`);
          // Revert to original text for font size reduction
          tempTextNode.characters = textNode.characters;
          if (typeof currentLineHeight === 'object') {
            tempTextNode.lineHeight = currentLineHeight;
          }
        }
      }
      
      // If not a name field or multi-line didn't work, proceed with font size reduction
      // Calculate required scaling factors
      const widthScale = overflowsWidth ? containerWidth / actualTextWidth : 1;
      const heightScale = overflowsHeight ? containerHeight / actualTextHeight : 1;
      
      // Use the more restrictive scale factor
      const scaleFactor = Math.min(widthScale, heightScale);
      
      // Calculate new font size with safety margins
      const safetyMargin = 1 - options.safetyMargin; // Convert to multiplier
      let newFontSize = Math.floor(originalFontSize * scaleFactor * safetyMargin);
      
      // Set minimum font sizes based on text length and field type
      let minFontSize = options.minFontSize; // Use user-defined minimum
      
      // Dynamic minimum based on content type and length using user thresholds
      if (isNameField) {
        // For names, be more conservative with font size reduction since we tried multi-line first
        if (textLength > options.nameThreshold * 1.5) minFontSize = Math.max(options.minFontSize, 9);
        else if (textLength > options.nameThreshold) minFontSize = Math.max(options.minFontSize, 10);
        else minFontSize = Math.max(options.minFontSize, 11);
      } else if (layerName.includes('address') || layerName.includes('location')) {
        // Addresses can be quite small
        if (textLength > options.addressThreshold * 1.5) minFontSize = options.minFontSize;
        else if (textLength > options.addressThreshold) minFontSize = Math.max(options.minFontSize, 7);
        else minFontSize = Math.max(options.minFontSize, 8);
      } else if (layerName.includes('title') || layerName.includes('position') || layerName.includes('designation')) {
        // Titles should be more readable
        if (textLength > 25) minFontSize = Math.max(options.minFontSize, 8);
        else minFontSize = Math.max(options.minFontSize, 10);
      } else if (layerName.includes('id') || layerName.includes('number') || layerName.includes('roll') || layerName.includes('student_id')) {
        // IDs and numbers should remain readable
        minFontSize = Math.max(options.minFontSize, 9);
      } else if (layerName.includes('class') || layerName.includes('grade') || layerName.includes('section')) {
        // Class info should be readable
        minFontSize = Math.max(options.minFontSize, 8);
      } else {
        // General text - use dynamic scaling based on length
        if (textLength > 40) minFontSize = options.minFontSize;
        else if (textLength > 20) minFontSize = Math.max(options.minFontSize, 8);
        else minFontSize = Math.max(options.minFontSize, 9);
      }
      
      // Ensure we don't go below minimum
      newFontSize = Math.max(minFontSize, newFontSize);
      
      console.log(`Resizing font from ${originalFontSize}px to ${newFontSize}px (min: ${minFontSize}px) for "${layerName}"`);
      
      // Test the new font size on the temporary node
      tempTextNode.fontSize = newFontSize;
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      
      // If still overflowing, try line height adjustment
      if (tempTextNode.width > containerWidth || tempTextNode.height > containerHeight) {
        if (tempTextNode.lineHeight && typeof tempTextNode.lineHeight === 'object' && 'unit' in tempTextNode.lineHeight && tempTextNode.lineHeight.unit === 'PIXELS') {
          const lineHeight = tempTextNode.lineHeight as { value: number; unit: 'PIXELS' };
          const newLineHeight = Math.max(newFontSize * 1.1, lineHeight.value * 0.9);
          tempTextNode.lineHeight = { value: newLineHeight, unit: 'PIXELS' };
        } else if (tempTextNode.lineHeight && typeof tempTextNode.lineHeight === 'object' && 'unit' in tempTextNode.lineHeight && tempTextNode.lineHeight.unit === 'PERCENT') {
          const lineHeight = tempTextNode.lineHeight as { value: number; unit: 'PERCENT' };
          tempTextNode.lineHeight = { value: Math.max(100, lineHeight.value * 0.9), unit: 'PERCENT' };
        }
        
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        
        // Final check - if still overflowing, reduce further
        if ((tempTextNode.width > containerWidth || tempTextNode.height > containerHeight) && newFontSize > options.minFontSize) {
          newFontSize = Math.max(options.minFontSize, newFontSize - 1);
          tempTextNode.fontSize = newFontSize;
          console.log(`Final font size adjustment to ${newFontSize}px for "${layerName}"`);
        }
      }
      
      // Now apply the tested changes to the original text node
      textNode.fontSize = newFontSize;
      
      // Apply line height changes if they were made
      if (tempTextNode.lineHeight && typeof tempTextNode.lineHeight === 'object') {
        textNode.lineHeight = tempTextNode.lineHeight;
      }
      
      // For auto-layout, we need to handle sizing differently
      if (isInAutoLayout) {
        // In auto-layout, let the layout system handle the sizing
        // but preserve text alignment
        textNode.textAlignHorizontal = originalTextAlignHorizontal;
        textNode.textAlignVertical = originalTextAlignVertical;
        
        // If the text node was set to fill container width in auto-layout
        if (originalAutoResize === 'HEIGHT') {
          textNode.textAutoResize = 'HEIGHT';
        } else if (originalAutoResize === 'NONE') {
          textNode.textAutoResize = 'NONE';
          // For fixed-size text in auto-layout, maintain original dimensions
          textNode.resize(originalWidth, originalHeight);
        }
      } else {
        // For non-auto-layout, restore original sizing and positioning
        textNode.textAutoResize = originalAutoResize;
        textNode.resize(originalWidth, originalHeight);
        textNode.x = originalX;
        textNode.y = originalY;
        textNode.textAlignHorizontal = originalTextAlignHorizontal;
        textNode.textAlignVertical = originalTextAlignVertical;
      }
    }
    
    // Clean up temporary node
    if (tempTextNode.parent) {
      tempTextNode.remove();
    }
    
  } catch (error) {
    console.warn(`Auto-resize failed for "${textNode.characters}":`, error);
    
    // Fallback: restore original state
    try {
      const originalFontSize = textNode.fontSize as number;
      const originalWidth = textNode.width;
      const originalHeight = textNode.height;
      const originalX = textNode.x;
      const originalY = textNode.y;
      const originalTextAlignHorizontal = textNode.textAlignHorizontal;
      const originalTextAlignVertical = textNode.textAlignVertical;
      const originalAutoResize = textNode.textAutoResize;
      const isInAutoLayout = textNode.parent && textNode.parent.type === 'FRAME' && 
                            (textNode.parent as FrameNode).layoutMode !== 'NONE';
      
      textNode.textAutoResize = originalAutoResize || 'NONE';
      textNode.fontSize = originalFontSize;
      if (!isInAutoLayout) {
        textNode.resize(originalWidth, originalHeight);
        textNode.x = originalX;
        textNode.y = originalY;
      }
      textNode.textAlignHorizontal = originalTextAlignHorizontal;
      textNode.textAlignVertical = originalTextAlignVertical;
    } catch (restoreError) {
      console.warn('Failed to restore text state:', restoreError);
    }
  }
}

// Helper function to convert long names to multi-line format
function convertToMultiLine(text: string): string {
  const words = text.trim().split(/\s+/);
  
  if (words.length <= 1) {
    return text; // Can't split single word
  }
  
  // Strategy 1: If there are 2 words, put each on a separate line
  if (words.length === 2) {
    return words.join('\n');
  }
  
  // Strategy 2: For 3+ words, try to balance the lines
  if (words.length >= 3) {
    const totalLength = text.length;
    const targetLength = Math.ceil(totalLength / 2);
    
    let firstLine = '';
    let secondLine = '';
    let currentLength = 0;
    let splitIndex = 0;
    
    // Find the best split point
    for (let i = 0; i < words.length; i++) {
      const wordLength = words[i].length + (i > 0 ? 1 : 0); // +1 for space
      
      if (currentLength + wordLength <= targetLength || i === 0) {
        currentLength += wordLength;
        splitIndex = i;
      } else {
        break;
      }
    }
    
    // Ensure we don't put all words on first line
    if (splitIndex >= words.length - 1) {
      splitIndex = Math.floor(words.length / 2) - 1;
    }
    
    firstLine = words.slice(0, splitIndex + 1).join(' ');
    secondLine = words.slice(splitIndex + 1).join(' ');
    
    return firstLine + '\n' + secondLine;
  }
  
  return text; // Fallback
}

async function loadImageFromData(rectNode: RectangleNode, imageData: Uint8Array, imageScaling: string = 'FILL') {
  try {
    console.log(`Loading image from uploaded data, size: ${imageData.length} bytes`);
    console.log(`Rectangle dimensions: ${rectNode.width}x${rectNode.height}`);
    
    // Create image in Figma
    const image = figma.createImage(imageData);
    console.log(`Image created with hash: ${image.hash}`);
    
    // Clear existing fills first
    rectNode.fills = [];
    
    // Apply as fill
    const newFills: Paint[] = [
      {
        type: 'IMAGE',
        imageHash: image.hash,
        scaleMode: imageScaling as 'FILL' | 'CROP' | 'FIT',
        scalingFactor: 1
      }
    ];
    
    rectNode.fills = newFills;
    console.log(`Successfully applied uploaded image to rectangle "${rectNode.name}" with scale mode: ${imageScaling}`);
    
  } catch (error) {
    console.error(`Failed to load image from data:`, error);
    createImagePlaceholder(rectNode, 'Failed to load uploaded image');
    throw error;
  }
}

async function loadImageFromUrl(rectNode: RectangleNode, imageUrl: string, imageScaling: string = 'FILL') {
  try {
    console.log(`Loading image from URL: ${imageUrl}`);
    console.log(`Rectangle dimensions: ${rectNode.width}x${rectNode.height}`);
    
    // Fetch the image - Figma's fetch is simpler
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`Image data size: ${arrayBuffer.byteLength} bytes`);
    
    if (arrayBuffer.byteLength === 0) {
      throw new Error('Empty image data received');
    }
    
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Create image in Figma
    const image = figma.createImage(uint8Array);
    console.log(`Image created with hash: ${image.hash}`);
    
    // Clear existing fills first
    rectNode.fills = [];
    
    // Apply as fill
    const newFills: Paint[] = [
      {
        type: 'IMAGE',
        imageHash: image.hash,
        scaleMode: imageScaling as 'FILL' | 'CROP' | 'FIT',
        scalingFactor: 1
      }
    ];
    
    rectNode.fills = newFills;
    console.log(`Successfully applied image to rectangle "${rectNode.name}" with scale mode: ${imageScaling}`);
    
  } catch (error) {
    console.error(`Failed to load image from ${imageUrl}:`, error);
    createImagePlaceholder(rectNode, `Failed to load: ${imageUrl.substring(0, 30)}...`);
    throw error;
  }
}

function createImagePlaceholder(rectNode: RectangleNode, message: string) {
  // Create a placeholder fill
  const fills: Paint[] = [
    {
      type: 'SOLID',
      color: { r: 0.95, g: 0.95, b: 0.95 } // Light gray background
    }
  ];
  rectNode.fills = fills;
  
  // Add error text indication
  try {
    const textNode = figma.createText();
    
    // Try to load a font, fallback to default if not available
    figma.loadFontAsync({ family: "Inter", style: "Regular" }).catch(() => {
      return figma.loadFontAsync({ family: "Roboto", style: "Regular" });
    }).then(() => {
      textNode.characters = message;
      textNode.fontSize = Math.min(8, rectNode.width / 20);
      textNode.textAlignHorizontal = 'CENTER';
      textNode.textAlignVertical = 'CENTER';
      textNode.resize(rectNode.width - 8, rectNode.height - 8);
      textNode.x = rectNode.x + 4;
      textNode.y = rectNode.y + 4;
      
      // Set text color to indicate issue
      const textFills: Paint[] = [
        {
          type: 'SOLID',
          color: { r: 0.6, g: 0.6, b: 0.6 } // Gray color
        }
      ];
      textNode.fills = textFills;
      
      // Add text to same parent as rectangle
      if (rectNode.parent && 'appendChild' in rectNode.parent) {
        (rectNode.parent as BaseNode & ChildrenMixin).appendChild(textNode);
      }
    }).catch(error => {
      console.warn('Failed to create placeholder text:', error);
    });
  } catch (textError) {
    console.warn('Failed to create placeholder text:', textError);
  }
}

// Initialize plugin
figma.ui.postMessage({ type: 'plugin-ready' });