import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/providers.dart';
import '../../config/env.dart';
import 'auth_controller.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _googlePending = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _openCrm(String path) async {
    final url = Uri.parse(crmPageUrl(ref.read(envProvider).apiUrl, path));
    await launchUrl(url, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final pending = auth.isLoading;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
          children: [
            const Text('VaChat', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(
              'Log in with your CRM account',
              style: TextStyle(color: Colors.blueGrey.shade600, fontSize: 16),
            ),
            const SizedBox(height: 32),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              enabled: !pending && !_googlePending,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              obscureText: _obscure,
              enabled: !pending && !_googlePending,
              onSubmitted: (_) => ref.read(authProvider.notifier).signIn(
                    email: _email.text,
                    password: _password.text,
                  ),
              decoration: InputDecoration(
                labelText: 'Password',
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                ),
              ),
            ),
            if (auth.error != null) ...[
              const SizedBox(height: 12),
              Text(auth.error!, style: const TextStyle(color: Color(0xFFB91C1C))),
            ],
            const SizedBox(height: 20),
            FilledButton(
              onPressed: pending || _googlePending
                  ? null
                  : () => ref.read(authProvider.notifier).signIn(
                        email: _email.text,
                        password: _password.text,
                      ),
              child: pending
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Log in'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: pending || _googlePending
                  ? null
                  : () async {
                      setState(() => _googlePending = true);
                      await ref.read(authProvider.notifier).signInWithGoogle();
                      if (mounted) setState(() => _googlePending = false);
                    },
              child: Text(_googlePending ? 'Opening Google…' : 'Continue with Google'),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () => _openCrm('/forgot-password'),
              child: const Text('Forgot password?'),
            ),
            TextButton(
              onPressed: () => _openCrm('/signup'),
              child: const Text('Create an account on the web'),
            ),
          ],
        ),
      ),
    );
  }
}
