/**
 * Prompt Detector - Detects interactive prompts in terminal output
 *
 * Identifies common prompt patterns that require user input:
 * - Yes/No confirmations: [y/n], [Y/n], (yes/no), etc.
 * - Password prompts: password:, Password:, passphrase, etc.
 * - Sudo prompts: [sudo]
 * - General confirmation prompts: Continue?, Proceed?, etc.
 */

export type PromptType = 'yesno' | 'password' | 'confirm';

export interface PromptMatch {
    type: PromptType;
    match: string;
}

// Prompt patterns organized by type
const PROMPT_PATTERNS: Array<{ type: PromptType; patterns: RegExp[] }> = [
    {
        type: 'yesno',
        patterns: [
            /\[y\/n\]/i,                    // [y/n], [Y/n], [y/N]
            /\[yes\/no\]/i,                 // [yes/no]
            /\(y\/n\)/i,                    // (y/n)
            /\(yes\/no\)/i,                 // (yes/no)
            /\[y\|n\]/i,                    // [y|n]
            /\(y\|n\)/i,                    // (y|n)
            /\byes or no\b/i,               // "yes or no"
            /\by\/n\b/i,                    // standalone y/n
        ]
    },
    {
        type: 'password',
        patterns: [
            /password\s*:/i,                // password:, Password :
            /passphrase\s*:/i,              // passphrase:
            /passphrase for\s+/i,           // passphrase for key
            /\[sudo\]/i,                    // [sudo] password prompt
            /sudo password/i,               // sudo password
            /enter password/i,              // Enter password
            /enter passphrase/i,            // Enter passphrase
            /authentication password/i,    // authentication password
            /private key passphrase/i,      // SSH key passphrase
            /token\s*:/i,                   // token:, Token:
            /secret\s*:/i,                  // secret:, Secret:
            /api[_-]?key\s*:/i,             // api_key:, API-key:
        ]
    },
    {
        type: 'confirm',
        patterns: [
            /continue\s*\?/i,               // Continue?
            /proceed\s*\?/i,                // Proceed?
            /are you sure\s*\?/i,           // Are you sure?
            /do you want to/i,              // Do you want to...
            /would you like to/i,           // Would you like to...
            /press enter to continue/i,     // Press Enter to continue
            /press any key/i,               // Press any key
            /overwrite\s*\?/i,              // Overwrite?
            /replace\s*\?/i,                // Replace?
            /delete\s*\?/i,                 // Delete?
            /remove\s*\?/i,                 // Remove?
            /confirm\s*\?/i,                // Confirm?
            /accept\s*\?/i,                 // Accept?
            /\[enter\]/i,                   // [Enter]
            /\(press enter\)/i,             // (Press Enter)
        ]
    }
];

/**
 * Detects if the given text contains an interactive prompt
 *
 * @param text - The terminal output text to check
 * @returns A PromptMatch object if a prompt is detected, null otherwise
 */
export function detectPrompt(text: string): PromptMatch | null {
    // Only check the last portion of text (prompts appear at the end)
    // This helps avoid false positives in long output
    const textToCheck = text.slice(-500);

    for (const { type, patterns } of PROMPT_PATTERNS) {
        for (const pattern of patterns) {
            const match = textToCheck.match(pattern);
            if (match) {
                return {
                    type,
                    match: match[0]
                };
            }
        }
    }

    return null;
}

/**
 * Check if a prompt requires hidden input (like passwords)
 */
export function isHiddenInputPrompt(prompt: PromptMatch): boolean {
    return prompt.type === 'password';
}

/**
 * Get a human-readable description of the prompt type
 */
export function getPromptDescription(prompt: PromptMatch): string {
    switch (prompt.type) {
        case 'yesno':
            return 'Yes/No confirmation';
        case 'password':
            return 'Password or secret input (will be hidden)';
        case 'confirm':
            return 'Confirmation required';
        default:
            return 'Input required';
    }
}
