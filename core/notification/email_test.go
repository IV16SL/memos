package notification

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestEmailMemoReadCreatorLifecycle(t *testing.T) {
	ctx := context.Background()
	st := teststore.NewTestingStore(ctx, t)
	defer st.Close()
	dispatcher := NewEmailDispatcher(nil, st, nil)

	creator, err := st.CreateUser(ctx, &store.User{Username: "email-memo-creator", Role: store.RoleUser, PasswordHash: "hash"})
	require.NoError(t, err)
	viewer, err := st.CreateUser(ctx, &store.User{Username: "email-memo-viewer", Role: store.RoleUser, PasswordHash: "hash"})
	require.NoError(t, err)
	memo, err := st.CreateMemo(ctx, &store.Memo{
		UID: "email-memo-creator-lifecycle", CreatorID: creator.ID, Content: "memo", Visibility: store.Protected,
	})
	require.NoError(t, err)
	archived := store.Archived
	_, err = st.UpdateUser(ctx, &store.UpdateUser{ID: creator.ID, RowStatus: &archived})
	require.NoError(t, err)

	readable, err := dispatcher.listMemosByID(ctx, []int32{memo.ID}, viewer.ID)
	require.NoError(t, err)
	require.Contains(t, readable, memo.ID, "archiving the creator must not narrow an active PROTECTED memo")

	_, err = st.GetDriver().GetDB().ExecContext(ctx,
		fmt.Sprintf("UPDATE memo SET creator_id = 2147483000 WHERE id = %d", memo.ID))
	require.NoError(t, err)
	danglingMemo, err := st.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	require.NotNil(t, danglingMemo)
	readable, err = dispatcher.listMemosByID(ctx, []int32{danglingMemo.ID}, viewer.ID)
	require.NoError(t, err)
	require.NotContains(t, readable, danglingMemo.ID, "email rendering must fail closed for a missing memo creator")
}

func TestEmailSpaceInvitationFailsClosedWithoutPendingOffer(t *testing.T) {
	ctx := context.Background()
	st := teststore.NewTestingStore(ctx, t)
	defer st.Close()
	dispatcher := NewEmailDispatcher(&profile.Profile{InstanceURL: "https://memos.example.com/"}, st, nil)

	inviter, err := st.CreateUser(ctx, &store.User{Username: "email-space-inviter", Nickname: "Ada", Role: store.RoleUser, PasswordHash: "hash"})
	require.NoError(t, err)
	invitee, err := st.CreateUser(ctx, &store.User{Username: "email-space-invitee", Email: "invitee@example.com", Role: store.RoleUser, PasswordHash: "hash"})
	require.NoError(t, err)
	space, err := st.CreateSpace(ctx, &store.Space{UID: "email-space", Title: "Design team"}, inviter.ID)
	require.NoError(t, err)
	_, err = st.CreateSpaceInvitation(ctx, &store.SpaceInvitation{SpaceID: space.ID, UserID: invitee.ID, Role: store.SpaceMemberRoleAdmin}, inviter.ID)
	require.NoError(t, err)

	inbox := &store.Inbox{
		SenderID:   inviter.ID,
		ReceiverID: invitee.ID,
		Status:     store.UNREAD,
		Message: &storepb.InboxMessage{
			Type:    storepb.InboxMessage_SPACE_INVITATION,
			Payload: &storepb.InboxMessage_SpaceInvitation{SpaceInvitation: &storepb.InboxMessage_SpaceInvitationPayload{SpaceId: space.ID}},
		},
	}
	message, err := dispatcher.buildInboxEmailMessage(ctx, inbox, invitee, inviter, nil, "en")
	require.NoError(t, err)
	require.NotNil(t, message)
	require.Equal(t, []string{"invitee@example.com"}, message.To)
	require.Equal(t, `[Memos] Ada invited you to join "Design team"`, message.Subject)
	require.Contains(t, message.Body, `Ada invited you to join the Space "Design team" as an administrator.`)
	require.Contains(t, message.Body, "https://memos.example.com/inbox")

	require.NoError(t, st.DeclineSpaceInvitation(ctx, &store.DeclineSpaceInvitation{SpaceID: space.ID, UserID: invitee.ID}, invitee.ID))
	message, err = dispatcher.buildInboxEmailMessage(ctx, inbox, invitee, inviter, nil, "en")
	require.NoError(t, err)
	require.Nil(t, message, "a declined invitation must not be emailed")
}

func TestEmailTemplatesUseReceiverLocale(t *testing.T) {
	ctx := context.Background()
	st := teststore.NewTestingStore(ctx, t)
	defer st.Close()
	dispatcher := NewEmailDispatcher(&profile.Profile{InstanceURL: "https://memos.example.com/"}, st, nil)

	require.Equal(t, "zh", emailLangForLocale("zh-Hans"))
	require.Equal(t, "zh", emailLangForLocale("zh-Hant"))
	require.Equal(t, "en", emailLangForLocale("en"))
	require.Equal(t, "en", emailLangForLocale(""))

	creator, err := st.CreateUser(ctx, &store.User{Username: "email-zh-creator", Nickname: "创作者", Role: store.RoleUser, PasswordHash: "hash"})
	require.NoError(t, err)
	receiver, err := st.CreateUser(ctx, &store.User{Username: "email-zh-receiver", Email: "receiver@example.com", Role: store.RoleUser, PasswordHash: "hash"})
	require.NoError(t, err)
	memo, err := st.CreateMemo(ctx, &store.Memo{
		UID: "email-zh-memo", CreatorID: receiver.ID, Content: "memo", Visibility: store.Public,
	})
	require.NoError(t, err)
	comment, err := st.CreateMemo(ctx, &store.Memo{
		UID: "email-zh-comment", CreatorID: creator.ID, Content: "comment", Visibility: store.Public,
	})
	require.NoError(t, err)
	memosByID := map[int32]*store.Memo{memo.ID: memo, comment.ID: comment}

	inbox := &storepb.InboxMessage{
		Type: storepb.InboxMessage_MEMO_COMMENT,
		Payload: &storepb.InboxMessage_MemoComment{
			MemoComment: &storepb.InboxMessage_MemoCommentPayload{MemoId: comment.ID, RelatedMemoId: memo.ID},
		},
	}
	zhMsg, err := dispatcher.buildMemoCommentEmailMessage(inbox, receiver, "创作者", memosByID, "zh")
	require.NoError(t, err)
	require.NotNil(t, zhMsg)
	require.Equal(t, "[Memos] 创作者 评论了你的备忘录", zhMsg.Subject)
	require.Contains(t, zhMsg.Body, "评论了你的备忘录")
	require.Contains(t, zhMsg.Body, "https://memos.example.com/memos/email-zh-memo#email-zh-comment")

	enMsg, err := dispatcher.buildMemoCommentEmailMessage(inbox, receiver, "Creator", memosByID, "en")
	require.NoError(t, err)
	require.NotNil(t, enMsg)
	require.Equal(t, "[Memos] Creator commented on your memo", enMsg.Subject)

	testZh := NewTestEmailMessage("a@example.com", "", "zh")
	require.Equal(t, "[Memos] 测试邮件", testZh.Subject)
	require.Contains(t, testZh.Body, "测试邮件")
	testEn := NewTestEmailMessage("a@example.com", "", "en")
	require.Equal(t, "[Memos] Test email", testEn.Subject)
}
