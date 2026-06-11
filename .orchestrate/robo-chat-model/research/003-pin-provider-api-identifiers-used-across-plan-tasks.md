{
"codex_validation": "n/a",
"conflict": false,
"context": "Pin provider API identifiers used across plan tasks",
"corroboration_status": "single",
"decision_impact": "kept-plan",
"effective_sources": 1,
"excerpt": "package.json contribution languageModelChatProviders; vscode.lm.registerLanguageModelChatProvider; LanguageModelChatProvider.provideLanguageModelChatInformation + provideLanguageModelChatResponse; LanguageModelChatInformation.capabilities.toolCalling; parts LanguageModelTextPart / LanguageModelToolC",
"id": "003",
"query": "VS Code LanguageModelChatProvider exact API names for Layer-1 task specs",
"sources": [
{
"date": "2026-06",
"kind": "primary",
"origin": "code.visualstudio.com",
"url": "https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider"
},
{
"date": "2025-08",
"kind": "primary",
"origin": "code.visualstudio.com",
"url": "https://code.visualstudio.com/updates/v1_104"
}
],
"timestamp": "2026-06-11T13:34:57",
"total_sources": 2,
"uncertainty": "API stable since 1.104; signed-out availability since 1.122 (engines floor)."
}
