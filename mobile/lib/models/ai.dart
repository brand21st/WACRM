class AiConfig {
  const AiConfig({
    required this.configured,
    this.isActive,
    this.autoReplyEnabled,
    this.fullAgentEnabled,
    this.provider,
    this.model,
  });

  final bool configured;
  final bool? isActive;
  final bool? autoReplyEnabled;
  final bool? fullAgentEnabled;
  final String? provider;
  final String? model;

  bool get isFullAgentOn => configured && fullAgentEnabled == true;

  factory AiConfig.fromJson(Map<String, dynamic> json) {
    return AiConfig(
      configured: json['configured'] == true,
      isActive: json['is_active'] as bool?,
      autoReplyEnabled: json['auto_reply_enabled'] as bool?,
      fullAgentEnabled: json['full_agent_enabled'] as bool?,
      provider: json['provider'] as String?,
      model: json['model'] as String?,
    );
  }

  Map<String, dynamic> toUpdateBody({required bool fullAgentEnabled}) {
    return {
      'full_agent_enabled': fullAgentEnabled,
      if (fullAgentEnabled) 'auto_reply_enabled': true,
      if (fullAgentEnabled) 'is_active': true,
    };
  }
}
