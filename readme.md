# Laravel Blade Translation Auto-Sync - VS Code Extension

A simple VS Code extension that automatically syncs Laravel translation keys from Blade files to existing translation files when you save.

## Features

- **Auto-Sync on Save**: Automatically extracts translation keys from Blade files and syncs them to corresponding PHP translation files when you save
- **Non-Destructive**: Only works with existing translation files - never creates new files automatically
- **Preserves Existing Translations**: Adds new keys without overwriting existing translation values
- **Comprehensive Pattern Detection**: Finds various Laravel translation patterns in your Blade files

## How It Works

1. **Save a Blade file** (e.g., `welcome.blade.php`)
2. **Extension checks** if corresponding translation file exists (e.g., `welcome.php`)
3. **If translation file exists**: Extracts translation keys and syncs them
4. **If translation file doesn't exist**: Does nothing (you control which files need translations)

## Supported Translation Patterns

The extension detects these Laravel translation patterns in your Blade files:

- `{{ __('key') }}` and `{{ __("key") }}`
- `@lang('key')` and `@lang("key")`
- `{{ trans('key') }}` and `{{ trans("key") }}`
- `{!! __('key') !!}` and `{!! __("key") !!}`
- `{!! trans('key') !!}` and `{!! trans("key") !!}`
- Standalone `__('key')` and `trans('key')`

## Example Workflow

### 1. Create your translation file manually

Create `welcome.php` in the same directory as your Blade file:

```php
<?php
return [
    'en' => [
        // Your existing translations
    ],
    'zh' => [
        // Your existing translations
    ],
];
```

### 2. Edit your Blade file

Edit `welcome.blade.php`:

```html
<h1>{{ __('Welcome to our site') }}</h1>
<p>{{ __('Please login') }}</p>
<span>{{ __('New feature') }}</span>
```

### 3. Save the Blade file

When you save `welcome.blade.php`, the extension automatically updates `welcome.php`:

```php
<?php
return [
    'en' => [
        'New feature' => 'New feature',           // ← Added automatically
        'Please login' => 'Please login',         // ← Added automatically
        'Welcome to our site' => 'Welcome to our site', // ← Added automatically
    ],
    'zh' => [
        'New feature' => '',                      // ← Added (empty for translation)
        'Please login' => '',                     // ← Added (empty for translation)
        'Welcome to our site' => '',              // ← Added (empty for translation)
    ],
];
```

## Key Benefits

- ⚡ **Zero Configuration**: Just save your Blade files
- 🎯 **Selective**: Only works with existing translation files you've created
- 🔒 **Safe**: Never overwrites existing translations
- 🚀 **Fast**: Instant sync on save
- 🧹 **Clean**: No unnecessary commands or UI clutter

## License

MIT
