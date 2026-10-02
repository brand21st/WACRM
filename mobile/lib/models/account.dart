enum AccountRole { owner, admin, agent, viewer }

AccountRole parseAccountRole(String? value) {
  switch (value) {
    case 'owner':
      return AccountRole.owner;
    case 'admin':
      return AccountRole.admin;
    case 'agent':
      return AccountRole.agent;
    default:
      return AccountRole.viewer;
  }
}

int roleRank(AccountRole role) {
  switch (role) {
    case AccountRole.owner:
      return 4;
    case AccountRole.admin:
      return 3;
    case AccountRole.agent:
      return 2;
    case AccountRole.viewer:
      return 1;
  }
}

bool hasMinRole(AccountRole role, AccountRole min) =>
    roleRank(role) >= roleRank(min);

bool canSendMessages(AccountRole role) => hasMinRole(role, AccountRole.agent);

bool canEditAccountAiSettings(AccountRole role) =>
    hasMinRole(role, AccountRole.admin);

class MobileAuthResponse {
  const MobileAuthResponse({required this.accountId, required this.accountName, required this.role});

  final String accountId;
  final String accountName;
  final AccountRole role;

  factory MobileAuthResponse.fromJson(Map<String, dynamic> json) {
    final account = json['account'] as Map<String, dynamic>? ?? const {};
    return MobileAuthResponse(
      accountId: account['id'] as String? ?? '',
      accountName: account['name'] as String? ?? 'Account',
      role: parseAccountRole(json['role'] as String?),
    );
  }
}
