// SPDX-License-Identifier: Apache-2.0
export class BookmarkManager {
    async createBookmark(url: string, title: string, folderPath: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
        const folderId = await this.ensureFolderPath(folderPath);
        return chrome.bookmarks.create({
            parentId: folderId,
            title,
            url
        });
    }

    async moveBookmark(bookmarkId: string, folderPath: string[]): Promise<chrome.bookmarks.BookmarkTreeNode> {
        const folderId = await this.ensureFolderPath(folderPath);
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

    private async ensureFolderPath(path: string[]): Promise<string> {
        let currentId = '1'; // Bookmarks menu ID
        for (const folderName of path) {
            const existingFolder = await this.findFolder(currentId, folderName);
            if (existingFolder) {
                currentId = existingFolder.id;
            } else {
                const newFolder = await chrome.bookmarks.create({
                    parentId: currentId,
                    title: folderName
                });
                currentId = newFolder.id;
            }
        }
        return currentId;
    }

    private async findFolder(parentId: string, name: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
        const children = await chrome.bookmarks.getChildren(parentId);
        return children.find(child => child.title === name && !child.url) || null;
    }
}