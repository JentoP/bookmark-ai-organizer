// SPDX-License-Identifier: Apache-2.0
import { BookmarkManager } from '../utils/bookmark-manager';
import { LlmClassifier } from '../utils/llm-classifier';

class BackgroundService {
    private bookmarkManager: BookmarkManager;
    private classifier: LlmClassifier;

    constructor() {
        console.log('BackgroundService initializing...');
        this.bookmarkManager = new BookmarkManager();
        this.classifier = new LlmClassifier();
        this.initializeListeners();
        console.log('BackgroundService initialized successfully');
    }

    private initializeListeners() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('Received message:', request);
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async response
        });

        // Add installation and startup listeners
        chrome.runtime.onInstalled.addListener((details) => {
            console.log('Extension installed/updated:', details);
        });

        chrome.runtime.onStartup.addListener(() => {
            console.log('Extension startup');
        });
    }

    private async handleMessage(request: any, sender: any, sendResponse: (response: any) => void) {
        console.log('Handling message:', request.action);
        try {
            switch (request.action) {
                case 'CREATE_BOOKMARK':
                    const { url, title, classification } = request.data;
                    console.log('Creating bookmark:', { url, title, classification });
                    const bookmark = await this.bookmarkManager.createBookmark(
                        url,
                        title,
                        classification.folderPath
                    );
                    console.log('Bookmark created successfully:', bookmark);
                    sendResponse({ success: true, bookmark });
                    break;
                case 'ORGANIZE_ALL_BOOKMARKS':
                    console.log('Starting organization of all bookmarks...');
                    this.organizeAllBookmarks();
                    sendResponse({ success: true, message: 'Organization started' });
                    break;
                default:
                    console.warn('Unknown action:', request.action);
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            sendResponse({ success: false, error: errorMessage });
        }
    }

    private async organizeAllBookmarks() {
        try {
            const bookmarks = await this.bookmarkManager.getAllBookmarks();
            const existingFolders = await this.bookmarkManager.getExistingFolders();
            let processed = 0;
            const total = bookmarks.length;
            
            console.log(`Found ${total} bookmarks to organize.`);
            console.log(`Found ${existingFolders.length} existing folders.`);
            
            for (const bookmark of bookmarks) {
                try {
                    const classification = await this.classifier.classifyUrl(bookmark.url!, bookmark.title, existingFolders);
                    await this.bookmarkManager.moveBookmark(bookmark.id, classification.folderPath);
                    processed++;
                    
                    chrome.runtime.sendMessage({
                        action: 'ORGANIZE_PROGRESS',
                        data: { processed, total }
                    }).catch(() => {}); 
                    
                } catch (err) {
                    console.error(`Failed to organize bookmark ${bookmark.url}:`, err);
                }
                
                // Add a small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1000)); 
            }
            
            console.log('Cleaning up empty folders...');
            const removedCount = await this.bookmarkManager.removeEmptyFolders();
            console.log(`Removed ${removedCount} empty folders.`);

            chrome.runtime.sendMessage({
                action: 'ORGANIZE_COMPLETE',
                data: { processed, total, removedFolders: removedCount }
            }).catch(() => {});

        } catch (error) {
            console.error('Error organizing all bookmarks:', error);
            chrome.runtime.sendMessage({
                action: 'ORGANIZE_ERROR',
                error: error instanceof Error ? error.message : 'Unknown error'
            }).catch(() => {});
        }
    }
}

// Initialize the service
console.log('Starting BackgroundService...');
new BackgroundService();