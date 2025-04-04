import { App, TFile, TFolder, TAbstractFile, setIcon, Notice, normalizePath } from 'obsidian';
import OneNoteExplorerPlugin from '../main'; // Import plugin type for settings

// Callback type for handling item clicks in the main view
type ItemClickCallback = (itemEl: HTMLElement, isFolder: boolean, depth: number) => void;
type ItemDropCallback = (sourcePath: string, targetFolderPath: string) => void;
// Callbacks for drag-over timeout
type SetDragOverTimeoutCallback = (id: number, target: HTMLElement) => void;
type ClearDragOverTimeoutCallback = () => void;
type TriggerFolderOpenCallback = (folderPath: string, depth: number) => void;

// Helper function (could be in utils)
function isExcluded(path: string, patterns: string[]): boolean {
  const lowerPath = path.toLowerCase();
  for (const pattern of patterns) {
    if (lowerPath.includes(pattern)) {
      return true;
    }
  }
  return false;
}
// Helper function to get icon based on file extension
function getIconForFile(file: TFile): string {
  // Handle compound extensions first
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.excalidraw.md')) {
    return 'lucide-pencil'; // Excalidraw icon
  }

  // Then check the simple extension
  const extension = file.extension.toLowerCase();
  switch (extension) {
    case 'md':
      return 'document'; // Standard markdown
    case 'canvas':
      return 'lucide-layout-dashboard'; // Obsidian canvas icon
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'svg':
      return 'image-file'; // Generic image icon
    case 'pdf':
      return 'pdf-file'; // PDF icon
    // case 'excalidraw': // Handled by the filename check above
    //   return 'lucide-pencil'; // Excalidraw icon (pencil)
    case 'js':
    case 'ts':
      return 'code-glyph'; // Code icon
    case 'css':
      return 'css3'; // CSS icon
    case 'json':
      return 'braces'; // JSON icon
    // Add more common extensions if needed
    default:
      return 'document'; // Default icon for other files
  }
}


export async function renderColumnElement(
  app: App,
  plugin: OneNoteExplorerPlugin, // Pass plugin for settings
  folderPath: string,
  depth: number,
  existingColumnEl: HTMLElement | null, // Pass existing element to update
  handleItemClickCallback: ItemClickCallback, // Callback for item clicks
  renderColumnCallback: (folderPath: string, depth: number) => Promise<HTMLElement | null>, // Callback to render next column
  handleDropCallback: ItemDropCallback, // Callback for drop events
  // Add new callbacks for drag-over folder opening
  setDragOverTimeoutCallback: SetDragOverTimeoutCallback,
  clearDragOverTimeoutCallback: ClearDragOverTimeoutCallback,
  triggerFolderOpenCallback: TriggerFolderOpenCallback,
  dragOverTimeoutDelay: number // Pass delay from main view
): Promise<HTMLElement | null> {

  const columnEl = existingColumnEl || createDiv({ cls: 'onenote-explorer-column' });
  columnEl.dataset.path = folderPath;
  columnEl.dataset.depth = String(depth);
  columnEl.empty(); // Clear content before re-rendering

  // Create the content wrapper for items
  const contentWrapperEl = columnEl.createDiv({ cls: 'onenote-explorer-column-content' });

  let tChildren: TAbstractFile[];
  try {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      tChildren = folder.children;
    } else {
      console.warn(`Path is not a folder or does not exist: ${folderPath}`);
      // Add error message to content wrapper instead of column
      contentWrapperEl.createDiv({ text: `Not a folder: ${folderPath}` });
      return existingColumnEl ? null : columnEl;
    }
  } catch (error) {
    console.error(`Error accessing folder ${folderPath}:`, error);
    // Add error message to content wrapper instead of column
    contentWrapperEl.createDiv({ text: `Error loading: ${folderPath}` });
    return existingColumnEl ? null : columnEl;
  }

  const folders: TFolder[] = [];
  const files: TFile[] = [];
  for (const child of tChildren) {
    if (child instanceof TFolder) {
      folders.push(child);
    } else if (child instanceof TFile) {
      files.push(child);
    }
  }

  // --- Calculate Initial Stats ---
  let totalSize = 0;
  let hiddenFilesCount = 0;
  // Removed unused initialFileCount and initialFolderCount

  files.forEach(file => {
    totalSize += file.stat.size;
    if (file.name.startsWith('.')) {
      hiddenFilesCount++;
    }
  });

  // --- Sort ---
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  // --- Filter based on Exclusions & Hidden ---
  const exclusionPatterns = plugin.settings.exclusionPatterns
    .split('\n')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  const filteredFolders = folders.filter(folder => !isExcluded(folder.path, exclusionPatterns));
  const filteredFiles = files.filter(file => !isExcluded(file.path, exclusionPatterns) && !file.name.startsWith('.'));

  const displayedFolderCount = filteredFolders.length;
  const displayedFileCount = filteredFiles.length;

  // --- Get Settings Maps ---
  const emojiMap = plugin.settings.emojiMap; // Get emoji map from settings
  const iconAssociations = plugin.settings.iconAssociations; // Get icon associations

  // Render Filtered Folders
  for (const folder of filteredFolders) {
    // Exclusion check already done

    const folderName = folder.name;
    // Append items to the content wrapper
    const itemEl = contentWrapperEl.createDiv({ cls: 'onenote-explorer-item nav-folder' });
    itemEl.dataset.path = folder.path;
    itemEl.draggable = true; // Make folders draggable
    const customIconFilename = iconAssociations[folder.path];
    const folderEmoji = emojiMap[folder.path];

    if (customIconFilename) {
      // Render custom icon using getResourcePath directly
      const iconFullPath = normalizePath(`.onenote-explorer-data/icons/${customIconFilename}`);
      // Use adapter.getResourcePath which works for files not indexed as TFiles
      const iconSrc = app.vault.adapter.getResourcePath(iconFullPath);
      // Basic check if resource path generation worked (it might return the input path on failure)
      if (iconSrc && iconSrc !== iconFullPath) {
        itemEl.createEl('img', {
          cls: 'onenote-explorer-item-icon custom-icon',
          attr: { src: iconSrc, alt: folder.name }
        });
      } else {
        // Fallback if getResourcePath fails or returns the original path
        console.warn(`Could not get resource path for folder icon: ${iconFullPath}. Falling back.`);
        setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-folder-icon' }), 'folder');
      }
    } else if (folderEmoji) {
      // Render emoji
      itemEl.createSpan({ cls: 'onenote-explorer-item-emoji', text: folderEmoji });
      itemEl.dataset.emoji = folderEmoji; // Store for potential use
    } else {
      // Render default folder icon
      setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-folder-icon' }), 'folder');
    }
    itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: folderName });
    // Add arrow icon to the right for folders
    setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-arrow' }), 'chevron-right');

    itemEl.addEventListener('click', async (event) => {
      handleItemClickCallback(itemEl, true, depth); // Use callback
      try {
        const nextColumnEl = await renderColumnCallback(folder.path, depth + 1); // Use callback
        if (nextColumnEl) {
          // Appending needs to happen in the main view, as this module doesn't know the container
          // We signal back that a new column needs appending. How?
          // Option 1: Return the new element (breaks Promise<null> for updates)
          // Option 2: Pass an append callback (getting complex)
          // Option 3: Let handleItemClick handle appending in the main view? Yes.
          // So, renderColumnCallback just returns the element, handleItemClick appends it.
          // This function (renderColumnElement) shouldn't append.
        }
        // Scroll logic also needs to be in the main view's handleItemClick
      } catch (error) {
        console.error("Error rendering next column:", error);
        new Notice(`Error rendering folder: ${folderName}`);
      }
    });

    // --- Drag and Drop Listeners for Folders (as Drop Targets) ---
    itemEl.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', folder.path);
      event.dataTransfer?.setData('text/type', 'folder'); // Indicate type
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      itemEl.addClass('is-dragging'); // Optional: visual feedback
      console.log(`Drag Start Folder: ${folder.path}`);
    });

    itemEl.addEventListener('dragend', (event) => {
      itemEl.removeClass('is-dragging');
    });

    // Allow dropping onto folders
    itemEl.addEventListener('dragover', (event) => {
      event.preventDefault(); // Necessary to allow drop
      event.stopPropagation(); // Prevent bubbling to column listener
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      // Only add class and set timeout if not already highlighted
      if (!itemEl.classList.contains('drag-over')) {
        itemEl.addClass('drag-over');
        // --- Spring-loaded folder logic ---
        // Clear any previous timeout for other elements
        clearDragOverTimeoutCallback();
        // Set a new timeout to open this folder
        const timeoutId = window.setTimeout(() => {
          console.log(`Drag over timeout expired for: ${folder.path}`);
          triggerFolderOpenCallback(folder.path, depth);
        }, dragOverTimeoutDelay); // Use configured delay
        // Store the timeout ID and target element
        setDragOverTimeoutCallback(timeoutId, itemEl);
      }
    });

    itemEl.addEventListener('dragleave', (event) => {
      // Only remove highlight and clear timeout if the mouse truly leaves the item element
      if (!itemEl.contains(event.relatedTarget as Node)) {
        itemEl.removeClass('drag-over');
        clearDragOverTimeoutCallback();
      }
      event.stopPropagation(); // Still prevent bubbling
    });

    itemEl.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation(); // Prevent bubbling to column listener
      itemEl.removeClass('drag-over');
      clearDragOverTimeoutCallback(); // Clear timeout on drop
      const sourcePath = event.dataTransfer?.getData('text/plain');
      const sourceType = event.dataTransfer?.getData('text/type'); // Get type if needed
      const targetFolderPath = itemEl.dataset.path;

      if (sourcePath && targetFolderPath && sourcePath !== targetFolderPath) {
        console.log(`Drop: Source=${sourcePath} (${sourceType}), TargetFolder=${targetFolderPath}`);
        handleDropCallback(sourcePath, targetFolderPath); // Use callback
      } else {
        console.log("Drop ignored: missing path or dropping onto self.");
      }
    });
  }

  // Render Filtered Files
  for (const file of filteredFiles) {
    // Exclusion and hidden checks already done

    const fileName = file.name;
    // Append items to the content wrapper
    const itemEl = contentWrapperEl.createDiv({ cls: 'onenote-explorer-item nav-file' });
    itemEl.dataset.path = file.path;
    itemEl.draggable = true; // Make files draggable
    const customIconFilename = iconAssociations[file.path];
    const fileEmoji = emojiMap[file.path];

    if (customIconFilename) {
      // Render custom icon using getResourcePath directly
      const iconFullPath = normalizePath(`.onenote-explorer-data/icons/${customIconFilename}`);
      // Use adapter.getResourcePath which works for files not indexed as TFiles
      const iconSrc = app.vault.adapter.getResourcePath(iconFullPath);
      // Basic check if resource path generation worked (it might return the input path on failure)
      if (iconSrc && iconSrc !== iconFullPath) {
        itemEl.createEl('img', {
          cls: 'onenote-explorer-item-icon custom-icon',
          attr: { src: iconSrc, alt: file.name }
        });
      } else {
        // Fallback if getResourcePath fails or returns the original path
        console.warn(`Could not get resource path for file icon: ${iconFullPath}. Falling back.`);
        const iconName = getIconForFile(file);
        setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-file-icon' }), iconName);
      }
    } else if (fileEmoji) {
      // Render emoji
      itemEl.createSpan({ cls: 'onenote-explorer-item-emoji', text: fileEmoji });
      itemEl.dataset.emoji = fileEmoji; // Store for potential use
    } else {
      // Render default file icon
      const iconName = getIconForFile(file);
      setIcon(itemEl.createSpan({ cls: 'onenote-explorer-item-icon nav-file-icon' }), iconName);
    }

    // Determine the display name: Use H1 heading if available, otherwise basename
    let displayFileName = file.basename; // Start with basename (no extension)
    if (file.extension.toLowerCase() === 'md') {
      const fileCache = app.metadataCache.getFileCache(file);
      const firstHeading = fileCache?.headings?.[0]?.heading;
      if (firstHeading) {
        displayFileName = firstHeading;
      }
      // Handle Excalidraw naming convention if no H1 is present
      else if (fileName.toLowerCase().endsWith('.excalidraw.md')) {
        displayFileName = fileName.slice(0, -'.excalidraw.md'.length);
      }
    }

    itemEl.createSpan({ cls: 'onenote-explorer-item-title', text: displayFileName });

    itemEl.addEventListener('click', (event) => {
      handleItemClickCallback(itemEl, false, depth); // Use callback
      app.workspace.openLinkText(file.path, '', false);
    });

    // --- Drag Listener for Files (as Draggable Items) ---
    itemEl.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', file.path);
      event.dataTransfer?.setData('text/type', 'file'); // Indicate type
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      itemEl.addClass('is-dragging'); // Optional: visual feedback
      console.log(`Drag Start File: ${file.path}`);
    });

    itemEl.addEventListener('dragend', (event) => {
      itemEl.removeClass('is-dragging');
    });
  }

  // Add drop listeners to the content wrapper background (for dropping into this folder)
  contentWrapperEl.addEventListener('dragover', (event) => {
    event.preventDefault(); // Allow drop
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    // Add highlight only if dragging directly over the content background
    const targetElement = event.target as HTMLElement;
    if (targetElement === contentWrapperEl) {
      contentWrapperEl.addClass('drag-over-column'); // Use the same class for visual feedback
      // If dragging onto content background, clear any item hover timeout
      clearDragOverTimeoutCallback();
    } else {
      contentWrapperEl.removeClass('drag-over-column'); // Remove if over an item
    }
  });

  contentWrapperEl.addEventListener('dragleave', (event) => {
    contentWrapperEl.removeClass('drag-over-column');
    // Also clear item hover timeout if leaving content bounds entirely
    if (!contentWrapperEl.contains(event.relatedTarget as Node)) {
      clearDragOverTimeoutCallback();
    }
  });

  contentWrapperEl.addEventListener('drop', (event) => {
    event.preventDefault();
    contentWrapperEl.removeClass('drag-over-column');
    clearDragOverTimeoutCallback(); // Clear item timeout on drop
    // Ensure the drop happened directly on the content background, not on an item within it
    if (event.target !== contentWrapperEl) {
      console.log("Drop ignored: Target was an item within the content wrapper, not the background.");
      return;
    }

    const sourcePath = event.dataTransfer?.getData('text/plain');
    const targetFolderPath = columnEl.dataset.path; // Path of the folder this column represents

    if (sourcePath && targetFolderPath) {
      console.log(`Drop onto Content Background: Source=${sourcePath}, TargetFolder=${targetFolderPath}`);
      handleDropCallback(sourcePath, targetFolderPath);
    }
  });

  // --- Render Stats ---
  const statsEl = columnEl.createDiv({ cls: 'onenote-explorer-column-stats' });
  const statsItems: string[] = [];
  if (displayedFolderCount > 0) statsItems.push(`${displayedFolderCount} folder${displayedFolderCount > 1 ? 's' : ''}`);
  if (displayedFileCount > 0) statsItems.push(`${displayedFileCount} file${displayedFileCount > 1 ? 's' : ''}`);
  if (hiddenFilesCount > 0) statsItems.push(`${hiddenFilesCount} hidden`);

  // Format size
  let sizeString = '';
  if (totalSize > 0) {
    if (totalSize < 1024) {
      sizeString = `${totalSize} B`;
    } else if (totalSize < 1024 * 1024) {
      sizeString = `${(totalSize / 1024).toFixed(1)} KB`;
    } else if (totalSize < 1024 * 1024 * 1024) {
      sizeString = `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      sizeString = `${(totalSize / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    statsItems.push(sizeString);
  }

  statsEl.setText(statsItems.join(' | '));


  return columnEl; // Return the created/updated element
  // Stats element is appended directly to columnEl, after contentWrapperEl
}