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

    // Updated patterns to handle Laravel translation with parameters
    const patterns = [
        // {{ __('key') }} and {{ __('key', [...]) }}
        /\{\{\s*__\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\[[^\]]*\])?\s*\)\s*\}\}/g,

        // @lang('key') and @lang('key', [...])
        /@lang\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\[[^\]]*\])?\s*\)/g,

        // {{ trans('key') }} and {{ trans('key', [...]) }}
        /\{\{\s*trans\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\[[^\]]*\])?\s*\)\s*\}\}/g,

        // {!! __('key') !!} and {!! __('key', [...]) !!}
        /\{!!\s*__\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\[[^\]]*\])?\s*\)\s*!!\}/g,

        // __('key') and __('key', [...]) - standalone usage
        /(?<!\w)__\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\[[^\]]*\])?\s*\)/g,

        // trans('key') and trans('key', [...]) - standalone usage
        /(?<!\w)trans\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*\[[^\]]*\])?\s*\)/g
    ];

    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const key = match[1];
            if (!translationKeys.includes(key)) {
                translationKeys.push(key);
            }
        }
    });

    return translationKeys.sort();
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
        const languagePattern = /['"`]([^'"`]+)['"`]\s*=>\s*\[([\s\S]*?)\]/g;
        let match;

        while ((match = languagePattern.exec(content)) !== null) {
            const language = match[1];
            const keysBlock = match[2];

            languages[language] = {};

            // Improved key-value extraction that properly handles nested quotes
            // This will match the key, then find the corresponding value by counting quote pairs
            const lines = keysBlock.split('\n');

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('//') && trimmedLine !== '],') {
                    // Match the key part
                    const keyMatch = trimmedLine.match(/^['"`]([^'"`]+)['"`]\s*=>\s*/);
                    if (keyMatch) {
                        const key = keyMatch[1];
                        const afterKey = trimmedLine.substring(keyMatch[0].length);

                        // Extract the value by finding the matching quotes
                        let value = '';
                        const quoteChar = afterKey[0]; // First character should be quote

                        if (quoteChar === '"' || quoteChar === "'" || quoteChar === '`') {
                            let i = 1; // Start after opening quote
                            let escaped = false;

                            while (i < afterKey.length) {
                                const char = afterKey[i];

                                if (escaped) {
                                    value += char;
                                    escaped = false;
                                } else if (char === '\\') {
                                    escaped = true;
                                } else if (char === quoteChar) {
                                    // Found closing quote
                                    break;
                                } else {
                                    value += char;
                                }
                                i++;
                            }

                            // Process escape sequences
                            value = value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
                            languages[language][key] = value;
                        }
                    }
                }
            }
        }

        return { languages };
    } catch (error) {
        console.error('Error parsing PHP file:', error);
        return null;
    }
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
            // 正确处理包含单引号、双引号和HTML标签的值
            let value = data.languages[lang][key];

            // 转义反斜杠和单引号
            value = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

            phpContent.push(`        '${key}' => '${value}',`);
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
