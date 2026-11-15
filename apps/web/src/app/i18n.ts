import { useSyncExternalStore } from 'react';

// Interface text only. User data (CV/JD, jobs) and the English interview
// questions/feedback are never translated.
const vi = {
  'app.name': 'AI Job Hunter',
  'nav.main': 'Điều hướng chính',
  'nav.workspace': 'Điều hướng không gian làm việc',
  'nav.open': 'Mở điều hướng',
  'nav.close': 'Đóng điều hướng',
  'nav.dashboard': 'Tổng quan',
  'nav.jobs': 'Việc làm',
  'nav.discover': 'Khám phá',
  'nav.cv': 'CV của tôi',
  'nav.interview': 'Luyện phỏng vấn',
  'notFound.title': 'Không tìm thấy trang',
  'notFound.text': 'Trang này không tồn tại trong không gian làm việc của bạn.',
  'notFound.back': 'Quay lại Việc làm',
  'common.loading': 'Đang tải',
  'common.retry': 'Thử lại',
  'common.closeDialog': 'Đóng hộp thoại',
  'common.signOut': 'Đăng xuất',
  'language.label': 'Ngôn ngữ',
  'api.ready': 'API sẵn sàng',
  'api.unavailable': 'API không khả dụng',
  'api.checking': 'Đang kiểm tra API…',
  'api.checkAgain': 'Kiểm tra lại',
  'connect.title': 'Không thể kết nối',
  'auth.email': 'Email',
  'auth.password': 'Mật khẩu',
  'auth.newPassword': 'Mật khẩu mới',
  'auth.confirmPassword': 'Xác nhận mật khẩu',
  'auth.show': 'Hiện',
  'auth.hide': 'Ẩn',
  'auth.showPassword': 'Hiện mật khẩu',
  'auth.hidePassword': 'Ẩn mật khẩu',
  'auth.passwordHelper': 'Ít nhất {min} ký tự.',
  'auth.invalidEmail': 'Nhập địa chỉ email hợp lệ.',
  'auth.passwordTooLong': 'Mật khẩu tối đa 128 ký tự.',
  'auth.passwordTooShort': 'Mật khẩu cần ít nhất {min} ký tự.',
  'auth.passwordMismatch': 'Mật khẩu xác nhận không khớp.',
  'auth.enterPassword': 'Nhập mật khẩu.',
  'auth.signIn': 'Đăng nhập',
  'auth.signingIn': 'Đang đăng nhập…',
  'auth.noAccount': 'Chưa có tài khoản?',
  'auth.registerWithCode': 'Đăng ký bằng mã mời',
  'auth.forgotPassword': 'Quên mật khẩu?',
  'auth.register': 'Tạo tài khoản',
  'auth.registering': 'Đang tạo tài khoản…',
  'auth.invitationCode': 'Mã mời',
  'auth.invitationHelper': 'Mã do quản trị viên gửi cho bạn.',
  'auth.enterInvitation': 'Nhập mã mời.',
  'auth.haveAccount': 'Đã có tài khoản?',
  'auth.reset': 'Đặt lại mật khẩu',
  'auth.resetting': 'Đang đặt lại…',
  'auth.resetIntro':
    'Liên hệ quản trị viên để nhận mã đặt lại mật khẩu, sau đó nhập mã và mật khẩu mới bên dưới.',
  'auth.resetCode': 'Mã đặt lại mật khẩu',
  'auth.enterResetCode': 'Nhập mã đặt lại mật khẩu.',
  'auth.resetDone': 'Đã đặt lại mật khẩu. Vui lòng đăng nhập.',
  'auth.backToSignIn': 'Quay lại đăng nhập',
  'auth.error.INVALID_CREDENTIALS': 'Email hoặc mật khẩu không đúng.',
  'auth.error.REGISTRATION_FAILED':
    'Không thể tạo tài khoản. Mã mời có thể không hợp lệ, đã hết hạn hoặc đã được sử dụng, hoặc email này không dùng được.',
  'auth.error.RESET_FAILED':
    'Mã đặt lại mật khẩu không hợp lệ, đã hết hạn hoặc đã được sử dụng.',
  'auth.error.INVALID_INPUT': 'Vui lòng kiểm tra lại thông tin đã nhập.',
  'auth.error.TOO_MANY_ATTEMPTS':
    'Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
  'auth.error.NETWORK': 'Không thể kết nối tới máy chủ. Vui lòng thử lại.',
  'auth.error.UNEXPECTED': 'Đã có lỗi xảy ra. Vui lòng thử lại.',
};

export type MessageKey = keyof typeof vi;

const en: Record<MessageKey, string> = {
  'app.name': 'AI Job Hunter',
  'nav.main': 'Main navigation',
  'nav.workspace': 'Workspace navigation',
  'nav.open': 'Open navigation',
  'nav.close': 'Close navigation',
  'nav.dashboard': 'Dashboard',
  'nav.jobs': 'Jobs',
  'nav.discover': 'Discover',
  'nav.cv': 'My CV',
  'nav.interview': 'Interview Prep',
  'notFound.title': 'Page not found',
  'notFound.text': 'This page does not exist in your workspace.',
  'notFound.back': 'Back to Jobs',
  'common.loading': 'Loading',
  'common.retry': 'Try again',
  'common.closeDialog': 'Close dialog',
  'common.signOut': 'Sign out',
  'language.label': 'Language',
  'api.ready': 'API ready',
  'api.unavailable': 'API unavailable',
  'api.checking': 'Checking API…',
  'api.checkAgain': 'Check again',
  'connect.title': 'Cannot connect',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.newPassword': 'New password',
  'auth.confirmPassword': 'Confirm password',
  'auth.show': 'Show',
  'auth.hide': 'Hide',
  'auth.showPassword': 'Show password',
  'auth.hidePassword': 'Hide password',
  'auth.passwordHelper': 'At least {min} characters.',
  'auth.invalidEmail': 'Enter a valid email address.',
  'auth.passwordTooLong': 'Password can be at most 128 characters.',
  'auth.passwordTooShort': 'Password needs at least {min} characters.',
  'auth.passwordMismatch': 'Passwords do not match.',
  'auth.enterPassword': 'Enter your password.',
  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in…',
  'auth.noAccount': 'No account yet?',
  'auth.registerWithCode': 'Register with an invitation code',
  'auth.forgotPassword': 'Forgot password?',
  'auth.register': 'Create account',
  'auth.registering': 'Creating account…',
  'auth.invitationCode': 'Invitation code',
  'auth.invitationHelper': 'The code the administrator sent you.',
  'auth.enterInvitation': 'Enter the invitation code.',
  'auth.haveAccount': 'Already have an account?',
  'auth.reset': 'Reset password',
  'auth.resetting': 'Resetting…',
  'auth.resetIntro':
    'Ask the administrator for a password reset code, then enter it and your new password below.',
  'auth.resetCode': 'Password reset code',
  'auth.enterResetCode': 'Enter the password reset code.',
  'auth.resetDone': 'Your password was reset. Please sign in.',
  'auth.backToSignIn': 'Back to sign in',
  'auth.error.INVALID_CREDENTIALS': 'Email or password is incorrect.',
  'auth.error.REGISTRATION_FAILED':
    'Could not create the account. The invitation code may be invalid, expired or already used, or this email cannot be used.',
  'auth.error.RESET_FAILED':
    'The password reset code is invalid, expired or already used.',
  'auth.error.INVALID_INPUT': 'Please check the information you entered.',
  'auth.error.TOO_MANY_ATTEMPTS':
    'Too many attempts. Please wait a few minutes and try again.',
  'auth.error.NETWORK': 'Cannot reach the server. Please try again.',
  'auth.error.UNEXPECTED': 'Something went wrong. Please try again.',
};

export const LOCALES = { 'vi-VN': 'Tiếng Việt', 'en-US': 'English' } as const;
export type Locale = keyof typeof LOCALES;
const messages: Record<Locale, Record<MessageKey, string>> = {
  'vi-VN': vi,
  'en-US': en,
};
const STORAGE_KEY = 'ajh.locale';

function stored(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && value in LOCALES) return value as Locale;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return 'vi-VN';
}

let current = stored();
const listeners = new Set<() => void>();
const applyLang = () => {
  if (typeof document !== 'undefined')
    document.documentElement.lang = current.slice(0, 2);
};
applyLang();

export function setLocale(locale: Locale) {
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not persisted; the choice still applies for this page load.
  }
  applyLang();
  listeners.forEach((listener) => listener());
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values?: Record<string, string | number>,
) {
  return messages[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    values && name in values ? String(values[name]) : match,
  );
}

/** Current locale and `t`; re-renders every user when the language changes. */
export function useI18n() {
  const locale = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return {
    locale,
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
  };
}
