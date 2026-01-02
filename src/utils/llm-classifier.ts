// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai';
import { SecurityManager } from './security';
import { getProviderPreference, getSelectedOpenRouterModel, chooseDefaultOpenRouterModel, clearSelectedOpenRouterModel, setSelectedOpenRouterModel } from './openrouter';

interface AIProvider {
    name: string;
    baseURL: string;
    model: string;
}

export class LlmClassifier {
    private apiKey: string | undefined = undefined;
    private providerOverride: string | null = null;
    private selectedOpenRouterModel: string | null = null;
    private providers: Record<string, AIProvider> = {
        openai: {
            name: 'OpenAI',
            baseURL: 'https://api.openai.com/v1',
            model: 'gpt-3.5-turbo'
        },
        moonshot: {
            name: 'Moonshot (Kimi)',
            baseURL: 'https://api.moonshot.ai/v1',
            model: 'kimi-k2-0711-preview'
        },
        grok: {
            name: 'Grok',
            baseURL: 'https://api.x.ai/v1',
            model: 'grok-beta'
        },
        openrouter: {
            name: 'OpenRouter',
            baseURL: 'https://openrouter.ai/api/v1',
            model: 'openai/gpt-4o-mini'
        },
        groq: {
            name: 'Groq',
            baseURL: 'https://api.groq.com/openai/v1',
            model: 'llama-3.3-70b-versatile'
        },
        copilot: {
            name: 'GitHub Copilot',
            baseURL: 'https://api.githubcopilot.com',
            model: 'gpt-4o'
        },
    };

    constructor() {
        this.loadApiKey();
    }

    private async loadApiKey() {
        this.apiKey = (await SecurityManager.getApiKey())?.trim();
    }

    private async loadPreferences() {
        try {
            this.providerOverride = await getProviderPreference();
            this.selectedOpenRouterModel = await getSelectedOpenRouterModel();
        } catch (e) {
            console.warn('Failed to load provider preferences', e);
        }
    }

    private detectProvider(apiKey: string): AIProvider {
        // Auto-detect provider based on API key format or content
        if (apiKey.startsWith('gho_') || apiKey.startsWith('github_pat_')) {
            console.log('Detected GitHub token - using GitHub Copilot');
            return this.providers.copilot;
        } else if (apiKey.startsWith('gsk_')) {
            console.log('Selected provider: Groq');
            return this.providers.groq;
        } else if (apiKey.startsWith('sk-') && !apiKey.includes('kimi') && !apiKey.includes('or-v1')) {
            return this.providers.openai;
        } else if (apiKey.startsWith('sk-or-v1-') || apiKey.includes('openrouter')) {
            return this.providers.openrouter;
        } else if (apiKey.includes('kimi') || apiKey.length > 40) {
            return this.providers.moonshot;
        } else if (apiKey.includes('grok') || apiKey.startsWith('xai-')) {
            return this.providers.grok;
        }
        return this.providers.openrouter;
    }

    private async getGitHubCopilotToken(githubToken: string): Promise<string> {
        try {
            // Get Copilot token from GitHub API
            const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/json',
                    'Editor-Version': 'vscode/1.95.0',
                    'Editor-Plugin-Version': 'copilot/1.156.0',
                    'User-Agent': 'GitHubCopilot/1.156.0'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('GitHub Copilot token fetch failed:', response.status, errorText);
                throw new Error(`Failed to get Copilot token: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            return data.token;
        } catch (error) {
            console.error('Error fetching Copilot token:', error);
            throw new Error('Failed to authenticate with GitHub Copilot. Ensure you have Copilot Pro enabled on your account.');
        }
    }

    async classifyUrl(url: string, title: string, existingFolders: string[] = []): Promise<{ folderPath: string[], tags: string[] }> {
        await this.loadApiKey();

        if (!this.apiKey) {
            throw new Error('API key not configured. Please save your API key first.');
        }

        console.log('Using API key (first 10 chars):', this.apiKey.substring(0, 10) + '...');
        await this.loadPreferences();

        const baseProvider = (this.providerOverride && this.providers[this.providerOverride])
            ? this.providers[this.providerOverride]
            : this.detectProvider(this.apiKey);
        const provider = { ...baseProvider };

        if (provider.name === 'OpenRouter' && this.selectedOpenRouterModel) {
            provider.model = this.selectedOpenRouterModel;
        }
        console.log('Using provider:', provider.name, 'model:', provider.model);

        // Handle GitHub Copilot authentication
        let actualApiKey = this.apiKey;
        if (provider.name === 'GitHub Copilot') {
            console.log('Fetching GitHub Copilot OAuth token...');
            actualApiKey = await this.getGitHubCopilotToken(this.apiKey);
        }

        // Create OpenAI client with provider-specific configuration
        const clientConfig: any = {
            apiKey: actualApiKey,
            baseURL: provider.baseURL,
            dangerouslyAllowBrowser: true
        };

        // GitHub Copilot requires specific headers
        if (provider.name === 'GitHub Copilot') {
            clientConfig.defaultHeaders = {
                'Editor-Version': 'vscode/1.95.0',
                'Editor-Plugin-Version': 'copilot/1.156.0',
                'User-Agent': 'GitHubCopilot/1.156.0',
                'Openai-Organization': 'github-copilot',
                'Openai-Intent': 'conversation-panel'
            };
        }

        const client = new OpenAI(clientConfig);

        const existingFoldersList = existingFolders.length > 0 
            ? `\n\n**Existing Folders** (Prefer using these if relevant):\n${existingFolders.join('\n')}`
            : '';

        const prompt = `You are an AI information architect responsible for organizing bookmarks into a clean, minimal, long-term folder system.

Your primary goal is NOT to create new folders, but to reuse and consolidate existing ones into a small, stable hierarchy.

Think like a librarian, not a classifier.

---

### Core Principles (STRICT)

1. **Reuse over creation**
   - ALWAYS prefer existing folders if they are even a reasonable semantic match.
   - Treat folders with different emojis but the same meaning as duplicates.
   - Treat singular/plural and wording variations as the same category.

2. **One concept = one folder**
   - Never create multiple folders that represent the same idea (e.g. "Technology", "Tech", "💻 Technology").
   - Never nest a category inside itself or a near-duplicate (e.g. "Technology → Coding → Technology").

3. **Minimal structure**
   - Use the FEWEST folders possible.
   - Folder depth: 1–3 levels maximum.
   - Do NOT create a new top-level folder unless absolutely necessary.

4. **Broad → Specific**
   - Top-level folders are broad domains (e.g. Coding, Finance, News, Learning).
   - Subfolders narrow by purpose or format (e.g. Guides, News, Tools).
   - Deeper levels are for specific technologies or topics (e.g. HTML, Python).

5. **No path-style or malformed names**
   - Folder names must NEVER contain slashes, prefixes, or path fragments.
   - Never create folders like "/Category" or "Category/Subcategory".

---

### Folder Naming Rules

- Each folder name:
  - Starts with ONE simple emoji
  - Uses clear, human-friendly wording
  - Represents a stable concept that can hold many bookmarks
- Example of GOOD structure:
  - 🧑‍💻 Coding → 📘 Guides → 🌐 HTML
  - 🧑‍💻 Coding → 📰 News
- Example of BAD structure:
  - 💻 Technology + 🧑‍💻 Technology
  - Coding → Coding
  - /Technology → /Technology/HTML

---

### Existing Folders (CRITICAL)

You are given a list of existing folders.
You MUST:
- Normalize their meaning (ignore emoji differences).
- Reuse full or partial paths whenever possible.
- Only create a new folder if NO existing folder reasonably fits.

---

### Tags

- Generate 2–5 lowercase tags.
- Tags should describe content, not restate folder names.
- Prefer specific terms (e.g. "html", "frontend", "investing").

---

### Input

URL: ${url}  
Title: ${title}  
Existing Folders: ${existingFoldersList}

---

### Output Rules (MANDATORY)

- Output valid JSON ONLY.
- No explanations, no markdown.
- Structure:

{
  "folderPath": ["Emoji Folder", "Emoji Subfolder", "Emoji Topic"],
  "tags": ["tag1", "tag2", "tag3"]
}

---

### Examples

HTML guide article  
→ {"folderPath": ["🧑‍💻 Coding", "📘 Guides", "🌐 HTML"], "tags": ["html", "frontend", "web"]}

Tech news website  
→ {"folderPath": ["🧑‍💻 Coding", "📰 News"], "tags": ["tech", "industry", "news"]}

Finance investing blog  
→ {"folderPath": ["💰 Finance", "📈 Investing"], "tags": ["investing", "markets", "finance"]}

Global news site  
→ {"folderPath": ["📰 News"], "tags": ["news", "world", "current-events"]}
`;

        try {
            const attemptClassification = async (): Promise<string> => {
                const completion = await client.chat.completions.create({
                    model: provider.model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 300,
                    temperature: 0.2
                });
                return completion.choices[0].message.content || '';
            };

            let retried = false;
            let result: string | undefined;
            try {
                console.log(`Using ${provider.name} for classification (model=${provider.model})`);
                result = await attemptClassification();
            } catch (err) {
                if (provider.name === 'OpenRouter' && err instanceof OpenAI.APIError && err.status === 404 && !retried) {
                    console.warn('OpenRouter model returned 404; attempting fallback model. Original model:', provider.model);
                    retried = true;
                    await clearSelectedOpenRouterModel();
                    const apiKey = this.apiKey!;
                    const fallback = await chooseDefaultOpenRouterModel(apiKey);
                    if (fallback) {
                        provider.model = fallback;
                        console.log('Retrying with fallback OpenRouter model:', fallback);
                        await setSelectedOpenRouterModel(fallback);
                        result = await attemptClassification();
                    } else {
                        throw new Error('No fallback OpenRouter model available.');
                    }
                } else {
                    throw err;
                }
            }

            if (!result) {
                throw new Error('No response content received from AI provider');
            }
            const cleanResult = result.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(cleanResult);
            if (!parsed.folderPath || !Array.isArray(parsed.folderPath)) {
                throw new Error('Invalid response format: missing folderPath');
            }
            console.log('Classification successful:', parsed);
            return {
                folderPath: parsed.folderPath.slice(0, 3),
                tags: parsed.tags || []
            };
        } catch (error: unknown) {
            console.error('Classification error:', error);
            if (error instanceof OpenAI.APIError) {
                if (error.status === 401) {
                    throw new Error('Invalid API key. Please check your credentials.');
                } else if (error.status === 429) {
                    throw new Error('Rate limit exceeded. Please try again later.');
                } else if (error.status === 403) {
                    throw new Error('API access forbidden. Check your API key permissions.');
                } else {
                    throw new Error(`API Error (${error.status}): ${error.message}`);
                }
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Classification failed: ${errorMessage}`);
        }
    }
}