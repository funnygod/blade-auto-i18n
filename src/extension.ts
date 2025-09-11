import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    // 监听 Blade 文件保存事件
    let onSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.fileName.endsWith('.blade.php')) {
            autoGenerateTranslationFile(document);
        }
    });

    context.subscriptions.push(onSaveDisposable);
}

async function autoGenerateTranslationFile(document: vscode.TextDocument) {
    const bladeFile = document.uri.fsPath;
    const bladeDir = path.dirname(bladeFile);
    const bladeFileName = path.basename(bladeFile, '.blade.php');

    // 生成对应的 PHP 翻译文件路径
    const phpFile = path.join(bladeDir, `${bladeFileName}.php`);

    // 只有当对应的 PHP 文件存在时才进行处理
    if (!fs.existsSync(phpFile)) {
        return; // 文件不存在，什么都不做
    }

    const bladeContent = document.getText();

    // 提取翻译键
    const translationKeys = extractTranslationKeys(bladeContent);

    if (translationKeys.length === 0) {
        return; // 没有翻译键就不需要处理
    }

    try {
        // 同步翻译键到现有文件
        await syncTranslationFile(translationKeys, phpFile);
        vscode.window.showInformationMessage(`已同步翻译文件: ${bladeFileName}.php`);
    } catch (error) {
        vscode.window.showErrorMessage(`处理翻译文件时出错: ${error}`);
    }
}

function extractTranslationKeys(content: string): string[] {
    const translationKeys: string[] = [];

    // Helper function to extract keys from a specific pattern
    function extractKeysFromPattern(pattern: RegExp, content: string) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            // Find the opening quote after the function name
            const afterFunc = match[0];
            const funcName = match[1]; // __ or trans or lang

            // Find where the actual quote starts
            const quoteStart = afterFunc.indexOf('(') + 1;
            let pos = quoteStart;

            // Skip whitespace
            while (pos < afterFunc.length && /\s/.test(afterFunc[pos])) {
                pos++;
            }

            if (pos >= afterFunc.length) continue;

            const quoteChar = afterFunc[pos]; // Get the quote character
            if (quoteChar !== '"' && quoteChar !== "'" && quoteChar !== '`') continue;

            // Extract the key by finding the matching closing quote
            let key = '';
            pos++; // Move past opening quote
            let escaped = false;

            while (pos < afterFunc.length) {
                const char = afterFunc[pos];

                if (escaped) {
                    key += char;
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === quoteChar) {
                    // Found closing quote - make sure it's not inside nested quotes
                    break;
                } else {
                    key += char;
                }
                pos++;
            }

            if (key && !translationKeys.includes(key)) {
                translationKeys.push(key);
            }
        }
    }

    // More robust patterns that capture the entire function call
    const patterns = [
        // {{ __('...') }} and {{ __('...', [...]) }}
        /\{\{\s*(__\([^}]+\))\s*\}\}/g,

        // @lang('...') and @lang('...', [...])
        /@(lang\([^)]+\))/g,

        // {{ trans('...') }} and {{ trans('...', [...]) }}
        /\{\{\s*(trans\([^}]+\))\s*\}\}/g,

        // {!! __('...') !!} and {!! __('...', [...]) !!}
        /\{!!\s*(__\([^!]+\))\s*!!\}/g,

        // __('...') and __('...', [...]) - standalone usage
        /(?<!\w)(__\([^;,\n\r]*\))/g,

        // trans('...') and trans('...', [...]) - standalone usage
        /(?<!\w)(trans\([^;,\n\r]*\))/g
    ];

    // For each pattern, extract the function call and then parse it properly
    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const funcCall = match[1];

            // Extract the key from the function call
            const key = extractKeyFromFunctionCall(funcCall);
            if (key && !translationKeys.includes(key)) {
                translationKeys.push(key);
            }
        }
    });

    return translationKeys.sort();
}

// Helper function to properly extract key from function calls like __('key') or trans('key', [...])
function extractKeyFromFunctionCall(funcCall: string): string | null {
    // Find the opening parenthesis
    const parenIndex = funcCall.indexOf('(');
    if (parenIndex === -1) return null;

    let pos = parenIndex + 1;

    // Skip whitespace
    while (pos < funcCall.length && /\s/.test(funcCall[pos])) {
        pos++;
    }

    if (pos >= funcCall.length) return null;

    const quoteChar = funcCall[pos];
    if (quoteChar !== '"' && quoteChar !== "'" && quoteChar !== '`') return null;

    // Extract the key
    let key = '';
    pos++; // Move past opening quote
    let escaped = false;

    while (pos < funcCall.length) {
        const char = funcCall[pos];

        if (escaped) {
            key += char;
            escaped = false;
        } else if (char === '\\') {
            escaped = true;
        } else if (char === quoteChar) {
            // Found the closing quote
            return key;
        } else {
            key += char;
        }
        pos++;
    }

    return null; // No closing quote found
}

async function syncTranslationFile(newKeys: string[], phpFile: string) {
    try {
        // 读取现有的翻译文件
        const phpContent = fs.readFileSync(phpFile, 'utf8');
        let existingData = parseExistingPhpFile(phpContent);

        // 如果文件为空或无法解析，创建一个新的翻译结构
        if (!existingData) {
            existingData = {
                languages: {} // 空的语言对象
            };
        }

        // 合并新的翻译键，保留现有翻译
        const updatedData = mergeTranslationKeys(existingData, newKeys);
        const newContent = generatePhpFileFromData(updatedData);

        fs.writeFileSync(phpFile, newContent);
    } catch (error) {
        throw error;
    }
}

function parseExistingPhpFile(content: string): TranslationData | null {
    try {
        const languages: { [key: string]: { [key: string]: string } } = {};

        // Extract language blocks - improved regex to handle multiline content
        const languagePattern = /(['"`])([^'"`]+)\1\s*=>\s*\[([\s\S]*?)\]/g;
        let match;

        while ((match = languagePattern.exec(content)) !== null) {
            const language = match[2];
            const keysBlock = match[3];

            languages[language] = {};

            // Parse key-value pairs from the keys block
            const keyValuePairs = parseKeyValuePairs(keysBlock);

            for (const [key, value] of keyValuePairs) {
                languages[language][key] = value;
            }
        }

        return { languages };
    } catch (error) {
        console.error('Error parsing PHP file:', error);
        return null;
    }
}

// Helper function to parse key-value pairs from PHP array content
function parseKeyValuePairs(content: string): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    let pos = 0;

    while (pos < content.length) {
        // Skip whitespace and newlines
        while (pos < content.length && /\s/.test(content[pos])) {
            pos++;
        }

        if (pos >= content.length) break;

        // Check if we're at the end of the array
        if (content[pos] === ']') break;

        // Skip comments
        if (content.substr(pos, 2) === '//') {
            // Skip to end of line
            while (pos < content.length && content[pos] !== '\n') {
                pos++;
            }
            continue;
        }

        // Parse key
        const keyResult = parseQuotedString(content, pos);
        if (!keyResult) {
            // Skip this line if we can't parse the key
            while (pos < content.length && content[pos] !== '\n') {
                pos++;
            }
            continue;
        }

        const key = keyResult.value;
        pos = keyResult.newPos;

        // Skip whitespace and look for '=>'
        while (pos < content.length && /\s/.test(content[pos])) {
            pos++;
        }

        if (content.substr(pos, 2) !== '=>') {
            // Skip this line if we don't find '=>'
            while (pos < content.length && content[pos] !== '\n') {
                pos++;
            }
            continue;
        }

        pos += 2; // Skip '=>'

        // Skip whitespace
        while (pos < content.length && /\s/.test(content[pos])) {
            pos++;
        }

        // Parse value
        const valueResult = parseQuotedString(content, pos);
        if (!valueResult) {
            // Skip this line if we can't parse the value
            while (pos < content.length && content[pos] !== '\n') {
                pos++;
            }
            continue;
        }

        const value = valueResult.value;
        pos = valueResult.newPos;

        pairs.push([key, value]);

        // Skip to next line or comma
        while (pos < content.length && content[pos] !== '\n' && content[pos] !== ',') {
            pos++;
        }
        if (content[pos] === ',') {
            pos++; // Skip comma
        }
    }

    return pairs;
}

// Helper function to parse a quoted string starting at a given position
function parseQuotedString(content: string, startPos: number): { value: string; newPos: number } | null {
    let pos = startPos;

    // Skip whitespace
    while (pos < content.length && /\s/.test(content[pos])) {
        pos++;
    }

    if (pos >= content.length) return null;

    const quoteChar = content[pos];
    if (quoteChar !== '"' && quoteChar !== "'" && quoteChar !== '`') return null;

    pos++; // Move past opening quote
    let value = '';
    let escaped = false;

    while (pos < content.length) {
        const char = content[pos];

        if (escaped) {
            // Handle escaped characters
            if (char === 'n') {
                value += '\n';
            } else if (char === 't') {
                value += '\t';
            } else if (char === 'r') {
                value += '\r';
            } else if (char === '\\') {
                value += '\\';
            } else if (char === quoteChar) {
                value += char;
            } else {
                // For other escaped characters, keep them as-is
                value += char;
            }
            escaped = false;
        } else if (char === '\\') {
            escaped = true;
        } else if (char === quoteChar) {
            // Found closing quote
            pos++; // Move past closing quote
            return { value, newPos: pos };
        } else {
            value += char;
        }
        pos++;
    }

    return null; // No closing quote found
}

function mergeTranslationKeys(existingData: TranslationData, newKeys: string[]): TranslationData {
    const updatedLanguages: { [key: string]: { [key: string]: string } } = {};

    // 获取现有的语言设置，如果没有语言则使用 'ar' 作为默认
    let existingLanguages = Object.keys(existingData.languages);

    if (existingLanguages.length === 0) {
        existingLanguages = ['ar']; // 默认使用阿拉伯语
    }

    existingLanguages.forEach(lang => {
        updatedLanguages[lang] = {};

        // 合并新键，保留现有翻译
        newKeys.forEach(key => {
            if (existingData.languages[lang] && existingData.languages[lang][key] !== undefined) {
                // 保留现有翻译
                updatedLanguages[lang][key] = existingData.languages[lang][key];
            } else {
                // 添加新键，阿拉伯语和英文使用键名，其他语言留空
                updatedLanguages[lang][key] = (lang === 'en' || lang === 'ar') ? key : '';
            }
        });
    });

    return { languages: updatedLanguages };
}

function generatePhpFileFromData(data: TranslationData): string {
    const languages = Object.keys(data.languages);

    const phpContent = [
        '<?php',
        '',
        'return ['
    ];

    languages.forEach((lang, index) => {
        phpContent.push(`    '${lang}' => [`);

        const keys = Object.keys(data.languages[lang]).sort();
        keys.forEach(key => {
            const value = data.languages[lang][key];

            // Use double quotes for both key and value to avoid escaping issues with single quotes
            // Escape backslashes and double quotes only
            const escapedKey = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

            phpContent.push(`        "${escapedKey}" => "${escapedValue}",`);
        });

        phpContent.push('    ]' + (index < languages.length - 1 ? ',' : ''));
        if (index < languages.length - 1) {
            phpContent.push('');
        }
    });

    phpContent.push('];');

    return phpContent.join('\n') + '\n';
}

interface TranslationData {
    languages: { [language: string]: { [key: string]: string } };
}

export function deactivate() {}
