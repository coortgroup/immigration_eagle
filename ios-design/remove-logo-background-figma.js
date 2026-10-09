// Narrow Figma update for the user's header and bottom-tab logo request.
// File: D37t2aLjzF26fAkggMAZB5. Run with figma-use + figma-generate-library.
// 1. Upload assets/immigration-eagle-transparent.png using upload_assets.
// 2. Replace TRANSPARENT_IMAGE_HASH with that upload's returned imageHash.
// 3. Run this script, save returned IDs, inspect a screenshot, then delete only
//    the temporary upload frame if upload_assets created one.
// The original native app-icon component (7:79) remains unchanged.

const TRANSPARENT_IMAGE_HASH = 'REPLACE_WITH_UPLOADED_TRANSPARENT_IMAGE_HASH';
if (TRANSPARENT_IMAGE_HASH.startsWith('REPLACE_')) {
  throw new Error('Upload the transparent PNG and supply its confirmed imageHash before running.');
}

const page = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(page);
const [board, assets, original] = await Promise.all([
  figma.getNodeByIdAsync('3:24'),
  figma.getNodeByIdAsync('3:25'),
  figma.getNodeByIdAsync('7:79'),
]);
if (!board || !assets || !original || original.type !== 'COMPONENT') {
  throw new Error('Expected design or original icon missing; inspect the canvas before proceeding.');
}

// Capture the original artwork so preservation is explicitly checked.
const originalFills = JSON.stringify(original.fills);
const createdNodeIds = [], mutatedNodeIds = [];
let transparent = assets.children.find(n => n.type === 'COMPONENT' && n.name === 'Brand / Eagle transparent logo');
if (!transparent) {
  transparent = figma.createComponent();
  assets.appendChild(transparent);
  transparent.name = 'Brand / Eagle transparent logo';
  transparent.resize(64, 64);
  createdNodeIds.push(transparent.id);
} else {
  mutatedNodeIds.push(transparent.id);
}
transparent.fills = [{type:'IMAGE', imageHash:TRANSPARENT_IMAGE_HASH, scaleMode:'FIT'}];
transparent.cornerRadius = 0;
transparent.clipsContent = false;
transparent.effects = [];
transparent.strokes = [];
transparent.description = 'Transparent eagle and flag shield, derived from the supplied logo. Header and Eagle AI tab use; the original navy app icon remains a separate component.';

const targets = board.findAllWithCriteria({types:['INSTANCE']}).filter(n => {
  const parentName = n.parent?.name;
  const isTarget = parentName === 'Immigration Eagle / brand and account' || parentName === 'Tab / Eagle AI';
  return isTarget && (n.mainComponent?.id === original.id || n.mainComponent?.id === transparent.id);
});
if (!targets.length) throw new Error('No header or Eagle AI tab logo instances found; inspect the board.');
for (const node of targets) {
  const width = node.width, height = node.height;
  node.swapComponent(transparent);
  node.resize(width, height);
  node.fills = [{type:'IMAGE', imageHash:TRANSPARENT_IMAGE_HASH, scaleMode:'FIT'}];
  node.cornerRadius = 0;
  node.clipsContent = false;
  node.effects = [];
  node.strokes = [];
  node.name = 'Eagle / transparent header or tab artwork';
  mutatedNodeIds.push(node.id);
}
if (JSON.stringify(original.fills) !== originalFills) throw new Error('Original app icon unexpectedly changed.');
return {
  createdNodeIds, mutatedNodeIds,
  transparentLogoComponentId:transparent.id,
  preservedOriginalAppIconComponentId:original.id,
  updatedInstances:targets.map(n => ({id:n.id,parent:n.parent.name,width:n.width,height:n.height})),
  imageHash:TRANSPARENT_IMAGE_HASH,
};
