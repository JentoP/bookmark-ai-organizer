// SPDX-License-Identifier: Apache-2.0
export class BookmarkManager {
    async createBookmark(url: string, title: string, folderPath: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
        const cleanPath = this.sanitizeFolderPath(folderPath);
        const folderId = await this.ensureFolderPath(cleanPath);
        return chrome.bookmarks.create({
            parentId: folderId,
            title,
            url
        });
    }

    async moveBookmark(bookmarkId: string, folderPath: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
        const cleanPath = this.sanitizeFolderPath(folderPath);
        const folderId = await this.ensureFolderPath(cleanPath);
        return chrome.bookmarks.move(bookmarkId, { parentId: folderId });
    }

    async getAllBookmarks(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
        const tree = await chrome.bookmarks.getTree();
        const bookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];
        
        const traverse = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
            for (const node of nodes) {
                if (node.url) {
                    bookmarks.push(node);
                }
                if (node.children) {
                    traverse(node.children);
                }
            }
        };
        
        traverse(tree);
        return bookmarks;
    }

    async removeEmptyFolders(): Promise<number> {
        const tree = await chrome.bookmarks.getTree();
        let removedCount = 0;

        const traverseAndRemove = async (node: chrome.bookmarks.BookmarkTreeNode): Promise<boolean> => {
            // If it's a bookmark (has URL), it's not empty.
            if (node.url) {
                return false;
            }

            // If it's a folder, check its children
            let hasChildren = false;
            if (node.children && node.children.length > 0) {
                // Process children first (post-order traversal)
                // Create a copy of children to iterate safely
                const children = [...node.children];
                
                for (const child of children) {
                    // If child returns true, it means it was empty and removed (or is empty)
                    // If child returns false, it means it has content
                    const childRemovedOrEmpty = await traverseAndRemove(child);
                    if (!childRemovedOrEmpty) {
                        hasChildren = true;
                    }
                }
            }

            // If no children (or all children were removed), and this is a removable folder
            // Don't remove root folders (0) or system folders (1: Bookmarks Bar, 2: Other Bookmarks, etc.)
            // Note: IDs are strings. '0' is root. '1' is Bookmarks Bar. '2' is Other Bookmarks.
            const systemIds = ['0', '1', '2', '3']; 
            if (!hasChildren && !systemIds.includes(node.id)) {
                try {
                    await chrome.bookmarks.remove(node.id);
                    removedCount++;
                    return true; // Removed
                } catch (e) {
                    console.warn(`Failed to remove folder ${node.title} (${node.id})`, e);
                    return false; // Failed to remove
                }
            }

            return !hasChildren; // Return true if empty (even if not removed because it's system folder)
        };

        if (tree && tree.length > 0) {
            await traverseAndRemove(tree[0]);
        }
        
        return removedCount;
    }

    async getExistingFolders(): Promise<string[]> {
        try {
            const subTree = await chrome.bookmarks.getSubTree('1');
            const folders: string[] = [];

            if (subTree && subTree.length > 0 && subTree[0].children) {
                const traverse = (nodes: chrome.bookmarks.BookmarkTreeNode[], parentPath: string) => {
                    for (const node of nodes) {
                        if (!node.url) { // It's a folder
                            const currentPath = parentPath ? `${parentPath}/${node.title}` : node.title;
                            folders.push(currentPath);
                            if (node.children) {
                                traverse(node.children, currentPath);
                            }
                        }
                    }
                };
                traverse(subTree[0].children, '');
            }
            return folders;
        } catch (error) {
            console.error('Error fetching existing folders:', error);
            return [];
        }
    }

    private async ensureFolderPath(path: string[]): Promise<string> {
        let currentId = '1'; // Bookmarks menu ID
        let previousNormalized: string | null = null;

        for (const rawName of path) {
            const normalized = this.normalizeFolderName(rawName);

            // Prevent Category -> Category nesting
            if (previousNormalized === normalized) {
                continue;
            }

            const existingFolder = await this.findFolder(currentId, rawName);

            if (existingFolder) {
                currentId = existingFolder.id;
            } else {
                const newFolder = await chrome.bookmarks.create({
                    parentId: currentId,
                    title: rawName.trim().replace(/^\/+|\/+$/g, '')
                });
                currentId = newFolder.id;
            }
            
            previousNormalized = normalized;
        }
        return currentId;
    }

    private async findFolder(parentId: string, name: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
        const children = await chrome.bookmarks.getChildren(parentId);
        const target = this.normalizeFolderName(name);

        return children.find(child => 
            !child.url && 
            this.normalizeFolderName(child.title) === target
        ) || null;
    }

    private normalizeFolderName(name: string): string {
        return name
            .toLowerCase()
            .trim()
            .replace(/^\/+/, '')          // remove leading slashes
            .replace(/\/+$/, '')          // remove trailing slashes
            .replace(/\s+/g, ' ')         // collapse spaces
            .replace(/^[^\p{L}\p{N}]+/u, '') // strip leading emoji/symbols
            .normalize('NFKD');
    }

    private sanitizeFolderPath(path: string[]): string[] {
        const seen = new Set<string>();

        return path
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .filter(p => {
                const key = this.normalizeFolderName(p);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }
}