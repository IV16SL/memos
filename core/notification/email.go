package notification

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/email"
	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// EmailSender sends a prepared email message with the given SMTP configuration.
type EmailSender func(*email.Config, *email.Message)

// EmailDispatcher dispatches notification emails for inbox events.
type EmailDispatcher struct {
	profile *profile.Profile
	store   *store.Store
	sender  EmailSender
}

// NewEmailDispatcher creates a notification email dispatcher.
func NewEmailDispatcher(profile *profile.Profile, store *store.Store, sender EmailSender) *EmailDispatcher {
	if sender == nil {
		// Send synchronously. On serverless runtimes (e.g. Vercel) the
		// function instance is frozen as soon as the handler returns, so
		// the background workers behind email.SendAsync never finish the
		// SMTP round trip and the notification is silently lost. Trading
		// a short SMTP wait in the request for guaranteed delivery.
		sender = func(config *email.Config, message *email.Message) {
			if err := email.Send(config, message); err != nil {
				recipients := ""
				if message != nil && len(message.To) > 0 {
					recipients = message.To[0]
					if len(message.To) > 1 {
						recipients += " and others"
					}
				}
				slog.Warn("Failed to send notification email",
					slog.String("recipients", recipients),
					slog.Any("error", err))
			}
		}
	}
	return &EmailDispatcher{
		profile: profile,
		store:   store,
		sender:  sender,
	}
}

// emailLangForLocale maps a user locale to the notification email language.
// Only Chinese is localized for now; everything else falls back to English.
func emailLangForLocale(locale string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(locale)), "zh") {
		return "zh"
	}
	return "en"
}

// UserEmailLang resolves the notification email language for a user from
// their locale setting, defaulting to English.
func UserEmailLang(ctx context.Context, st *store.Store, userID int32) string {
	setting, err := st.GetUserSetting(ctx, &store.FindUserSetting{UserID: &userID, Key: storepb.UserSetting_GENERAL})
	if err != nil {
		slog.Warn("Failed to get user locale for notification email", slog.Any("err", err), slog.Int64("user_id", int64(userID)))
		return "en"
	}
	return emailLangForLocale(setting.GetGeneral().GetLocale())
}

// DispatchInboxEmail sends the email notification for an inbox entry when configured.
func (d *EmailDispatcher) DispatchInboxEmail(ctx context.Context, inbox *store.Inbox) error {
	if inbox == nil || inbox.Message == nil {
		return nil
	}

	setting, err := d.store.GetInstanceNotificationSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to get notification setting")
	}
	emailSetting := setting.GetEmail()
	if emailSetting == nil || !emailSetting.Enabled {
		return nil
	}
	if d.baseURL() == "" {
		slog.Warn("Skipping inbox email notification because instance URL is required",
			slog.Int64("inbox_id", int64(inbox.ID)),
			slog.Int64("receiver_id", int64(inbox.ReceiverID)))
		return nil
	}

	receiver, err := d.store.GetUser(ctx, &store.FindUser{ID: &inbox.ReceiverID})
	if err != nil {
		return errors.Wrap(err, "failed to get notification receiver")
	}
	if receiver == nil || strings.TrimSpace(receiver.Email) == "" {
		return nil
	}

	sender, err := d.store.GetUser(ctx, &store.FindUser{ID: &inbox.SenderID})
	if err != nil {
		return errors.Wrap(err, "failed to get notification sender")
	}
	if sender == nil {
		return nil
	}

	memosByID, err := d.listMemosByID(ctx, collectInboxMemoIDs([]*store.Inbox{inbox}), receiver.ID)
	if err != nil {
		return errors.Wrap(err, "failed to get notification memos")
	}

	message, err := d.buildInboxEmailMessage(ctx, inbox, receiver, sender, memosByID, UserEmailLang(ctx, d.store, receiver.ID))
	if err != nil {
		return err
	}
	if message == nil {
		return nil
	}
	message.ReplyTo = emailSetting.ReplyTo

	config := EmailConfigFromInstanceSetting(emailSetting)
	if err := config.Validate(); err != nil {
		return errors.Wrap(err, "invalid notification email setting")
	}

	d.sender(config, message)
	return nil
}

// EmailConfigFromInstanceSetting converts persisted notification settings into SMTP config.
func EmailConfigFromInstanceSetting(setting *storepb.InstanceNotificationSetting_EmailSetting) *email.Config {
	if setting == nil {
		return &email.Config{}
	}
	return &email.Config{
		SMTPHost:     setting.SmtpHost,
		SMTPPort:     int(setting.SmtpPort),
		SMTPUsername: setting.SmtpUsername,
		SMTPPassword: setting.SmtpPassword,
		FromEmail:    setting.FromEmail,
		FromName:     setting.FromName,
		UseTLS:       setting.UseTls,
		UseSSL:       setting.UseSsl,
	}
}

// NewTestEmailMessage builds the plain-text test email for notification settings.
func NewTestEmailMessage(recipientEmail, replyTo, lang string) *email.Message {
	subject := "[Memos] Test email"
	body := "This is a test email from your Memos notification settings."
	if lang == "zh" {
		subject = "[Memos] 测试邮件"
		body = "这是一封来自 Memos 通知设置的测试邮件。"
	}
	return &email.Message{
		To:      []string{recipientEmail},
		Subject: subject,
		Body:    body,
		ReplyTo: replyTo,
	}
}

// ValidateEmailSetting validates notification email SMTP settings.
func ValidateEmailSetting(setting *storepb.InstanceNotificationSetting_EmailSetting) error {
	return EmailConfigFromInstanceSetting(setting).Validate()
}

// SendTestEmail sends a plain-text test email using notification email settings.
func SendTestEmail(setting *storepb.InstanceNotificationSetting_EmailSetting, recipientEmail, locale string) error {
	return email.Send(EmailConfigFromInstanceSetting(setting), NewTestEmailMessage(recipientEmail, setting.GetReplyTo(), emailLangForLocale(locale)))
}

func (d *EmailDispatcher) buildInboxEmailMessage(ctx context.Context, inbox *store.Inbox, receiver *store.User, sender *store.User, memosByID map[int32]*store.Memo, lang string) (*email.Message, error) {
	senderName := displayNameForEmail(sender)
	switch inbox.Message.Type {
	case storepb.InboxMessage_MEMO_COMMENT:
		return d.buildMemoCommentEmailMessage(inbox.Message, receiver, senderName, memosByID, lang)
	case storepb.InboxMessage_MEMO_MENTION:
		return d.buildMemoMentionEmailMessage(inbox.Message, receiver, senderName, memosByID, lang)
	case storepb.InboxMessage_SPACE_INVITATION:
		return d.buildSpaceInvitationEmailMessage(ctx, inbox.Message, receiver, senderName, lang)
	default:
		return nil, nil
	}
}

// buildSpaceInvitationEmailMessage renders the invitation email only while
// the receiver still holds the pending offer, so a revoked or already handled
// invitation never reaches their mailbox.
func (d *EmailDispatcher) buildSpaceInvitationEmailMessage(ctx context.Context, message *storepb.InboxMessage, receiver *store.User, senderName string, lang string) (*email.Message, error) {
	payload := message.GetSpaceInvitation()
	if payload == nil || payload.SpaceId <= 0 {
		return nil, nil
	}
	space, err := d.store.GetSpace(ctx, &store.FindSpace{ID: &payload.SpaceId})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get invitation space")
	}
	if space == nil {
		return nil, nil
	}
	invitation, err := d.store.GetSpaceInvitation(ctx, &store.FindSpaceInvitation{
		SpaceID:      &space.ID,
		UserID:       &receiver.ID,
		ViewerUserID: &receiver.ID,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get space invitation")
	}
	if invitation == nil {
		return nil, nil
	}
	url := d.inboxURL()
	if url == "" {
		return nil, nil
	}

	roleName := "a member"
	if invitation.Role == store.SpaceMemberRoleAdmin {
		roleName = "an administrator"
	}
	body := []string{
		fmt.Sprintf("Hi %s,", displayNameForEmail(receiver)),
		"",
		fmt.Sprintf("%s invited you to join the Space \"%s\" as %s.", senderName, space.Title, roleName),
		"",
		"Review the invitation in Memos:",
		url,
		"",
		"You are receiving this because an administrator of this Space invited you.",
	}
	subject := fmt.Sprintf("[Memos] %s invited you to join \"%s\"", senderName, space.Title)
	if lang == "zh" {
		roleName = "成员"
		if invitation.Role == store.SpaceMemberRoleAdmin {
			roleName = "管理员"
		}
		body = []string{
			fmt.Sprintf("你好 %s，", displayNameForEmail(receiver)),
			"",
			fmt.Sprintf("%s 邀请你以%s身份加入空间「%s」。", senderName, roleName, space.Title),
			"",
			"在 Memos 中查看邀请：",
			url,
			"",
			"你收到这封邮件是因为该空间的管理员邀请了你。",
		}
		subject = fmt.Sprintf("[Memos] %s 邀请你加入「%s」", senderName, space.Title)
	}

	return &email.Message{
		To:      []string{receiver.Email},
		Subject: subject,
		Body:    strings.Join(body, "\n"),
	}, nil
}

func (d *EmailDispatcher) buildMemoCommentEmailMessage(message *storepb.InboxMessage, receiver *store.User, senderName string, memosByID map[int32]*store.Memo, lang string) (*email.Message, error) {
	payload := message.GetMemoComment()
	if payload == nil {
		return nil, nil
	}
	commentMemo := memosByID[payload.MemoId]
	relatedMemo := memosByID[payload.RelatedMemoId]
	if !canViewerAccessMemo(receiver, commentMemo) || !canViewerAccessMemo(receiver, relatedMemo) {
		return nil, nil
	}
	url := d.memoCommentURL(relatedMemo, commentMemo)
	if url == "" {
		return nil, nil
	}

	var subject, body string
	if lang == "zh" {
		subject = fmt.Sprintf("[Memos] %s 评论了你的备忘录", senderName)
		body = strings.Join([]string{
			fmt.Sprintf("你好 %s，", displayNameForEmail(receiver)),
			"",
			fmt.Sprintf("%s 评论了你的备忘录。", senderName),
			"",
			"在 Memos 中查看：",
			url,
			"",
			"你收到这封邮件是因为你是这条备忘录的所有者。",
		}, "\n")
	} else {
		subject = fmt.Sprintf("[Memos] %s commented on your memo", senderName)
		body = strings.Join([]string{
			fmt.Sprintf("Hi %s,", displayNameForEmail(receiver)),
			"",
			fmt.Sprintf("%s commented on your memo.", senderName),
			"",
			"Open in Memos:",
			url,
			"",
			"You are receiving this because you own this memo.",
		}, "\n")
	}

	return &email.Message{
		To:      []string{receiver.Email},
		Subject: subject,
		Body:    body,
	}, nil
}

func (d *EmailDispatcher) buildMemoMentionEmailMessage(message *storepb.InboxMessage, receiver *store.User, senderName string, memosByID map[int32]*store.Memo, lang string) (*email.Message, error) {
	payload := message.GetMemoMention()
	if payload == nil {
		return nil, nil
	}
	memo := memosByID[payload.MemoId]
	if !canViewerAccessMemo(receiver, memo) {
		return nil, nil
	}
	// A mention created from a comment carries its conversational context in
	// RelatedMemoId. The notification represents that relation, so suppress the
	// complete email unless the receiver can still read both endpoints.
	if payload.RelatedMemoId > 0 {
		if !canViewerAccessMemo(receiver, memosByID[payload.RelatedMemoId]) {
			return nil, nil
		}
	}
	url := d.memoURL(memo)
	if url == "" {
		return nil, nil
	}

	var subject, body string
	if lang == "zh" {
		subject = fmt.Sprintf("[Memos] %s 在备忘录中提到了你", senderName)
		body = strings.Join([]string{
			fmt.Sprintf("你好 %s，", displayNameForEmail(receiver)),
			"",
			fmt.Sprintf("%s 在备忘录中提到了你。", senderName),
			"",
			"在 Memos 中查看：",
			url,
			"",
			"你收到这封邮件是因为有人在这条备忘录中提到了你。",
		}, "\n")
	} else {
		subject = fmt.Sprintf("[Memos] %s mentioned you in a memo", senderName)
		body = strings.Join([]string{
			fmt.Sprintf("Hi %s,", displayNameForEmail(receiver)),
			"",
			fmt.Sprintf("%s mentioned you in a memo.", senderName),
			"",
			"Open in Memos:",
			url,
			"",
			"You are receiving this because you were mentioned in this memo.",
		}, "\n")
	}

	return &email.Message{
		To:      []string{receiver.Email},
		Subject: subject,
		Body:    body,
	}, nil
}

func (d *EmailDispatcher) listMemosByID(ctx context.Context, memoIDs []int32, viewerID int32) (map[int32]*store.Memo, error) {
	if len(memoIDs) == 0 {
		return map[int32]*store.Memo{}, nil
	}

	uniqueMemoIDs := make([]int32, 0, len(memoIDs))
	seenMemoIDs := make(map[int32]struct{}, len(memoIDs))
	for _, memoID := range memoIDs {
		if memoID == 0 {
			continue
		}
		if _, seen := seenMemoIDs[memoID]; seen {
			continue
		}
		seenMemoIDs[memoID] = struct{}{}
		uniqueMemoIDs = append(uniqueMemoIDs, memoID)
	}
	if len(uniqueMemoIDs) == 0 {
		return map[int32]*store.Memo{}, nil
	}

	memos, err := d.store.ListMemos(ctx, &store.FindMemo{
		IDList: uniqueMemoIDs,
		Access: &store.MemoAccessScope{UserID: &viewerID, AllowPublic: true, AllowProtected: true},
	})
	if err != nil {
		return nil, err
	}

	memosByID := make(map[int32]*store.Memo, len(memos))
	for _, memo := range memos {
		memosByID[memo.ID] = memo
	}
	return memosByID, nil
}

func collectInboxMemoIDs(inboxes []*store.Inbox) []int32 {
	memoIDs := make([]int32, 0, len(inboxes)*2)
	for _, inbox := range inboxes {
		if inbox == nil || inbox.Message == nil {
			continue
		}
		switch inbox.Message.Type {
		case storepb.InboxMessage_MEMO_COMMENT:
			payload := inbox.Message.GetMemoComment()
			if payload != nil {
				memoIDs = append(memoIDs, payload.MemoId, payload.RelatedMemoId)
			}
		case storepb.InboxMessage_MEMO_MENTION:
			payload := inbox.Message.GetMemoMention()
			if payload != nil {
				memoIDs = append(memoIDs, payload.MemoId, payload.RelatedMemoId)
			}
		default:
			// Ignore notification types without memo references.
		}
	}
	return memoIDs
}

func displayNameForEmail(user *store.User) string {
	if user == nil {
		return "there"
	}
	if strings.TrimSpace(user.Nickname) != "" {
		return user.Nickname
	}
	if strings.TrimSpace(user.Username) != "" {
		return user.Username
	}
	return "there"
}

func (d *EmailDispatcher) baseURL() string {
	if d.profile == nil || strings.TrimSpace(d.profile.InstanceURL) == "" {
		return ""
	}
	return strings.TrimRight(strings.TrimSpace(d.profile.InstanceURL), "/")
}

func (d *EmailDispatcher) inboxURL() string {
	baseURL := d.baseURL()
	if baseURL == "" {
		return ""
	}
	return baseURL + "/inbox"
}

func (d *EmailDispatcher) memoURL(memo *store.Memo) string {
	baseURL := d.baseURL()
	if memo == nil || memo.UID == "" || baseURL == "" {
		return ""
	}
	return fmt.Sprintf("%s/memos/%s", baseURL, memo.UID)
}

func (d *EmailDispatcher) memoCommentURL(relatedMemo *store.Memo, commentMemo *store.Memo) string {
	baseURL := d.baseURL()
	if relatedMemo == nil || relatedMemo.UID == "" || commentMemo == nil || commentMemo.UID == "" || baseURL == "" {
		return ""
	}
	return fmt.Sprintf("%s/memos/%s#%s", baseURL, relatedMemo.UID, commentMemo.UID)
}

func canViewerAccessMemo(viewer *store.User, memo *store.Memo) bool {
	if memo == nil {
		return false
	}
	if memo.Visibility == store.Private {
		return viewer != nil && viewer.ID == memo.CreatorID
	}
	return true
}
