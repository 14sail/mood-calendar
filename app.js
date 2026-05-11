function startApp() {
    if (window.db && window.auth && window.FirebaseMethods) {
        initLogic();
    } else {
        setTimeout(startApp, 100);
    }
}

function initLogic() {
    const { 
        collection, addDoc, getDocs, query, where, doc, getDoc, setDoc, orderBy,
        signInWithPopup, signOut, onAuthStateChanged 
    } = window.FirebaseMethods;
    const { GoogleAuthProvider } = window.FirebaseProviders;

    const themeSwitch = document.getElementById('themeSwitch');
    const calendarGrid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('monthDisplay');
    const modal = document.getElementById('modal-overlay');
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');
    const nicknameInput = document.getElementById('nickname-input');
    const emojiInput = document.getElementById('user-emoji-input'); // ✅ 新增
    const saveNicknameBtn = document.getElementById('save-nickname-btn');
    const friendSearchInput = document.getElementById('friend-search-input');
    const addFriendBtn = document.getElementById('add-friend-btn');
    const friendsListUI = document.getElementById('friends-list');
    const friendsSection = document.getElementById('friends-section');

    const editView = document.getElementById('record-edit-view');
    const detailView = document.getElementById('record-detail-view');
    const commentSection = document.getElementById('comments-section');
    const saveRecordBtn = document.getElementById('save-record');
    const emotionIndexSelect = document.getElementById('emotion-index');
    const indexLabel = document.getElementById('index-label');

    let currentDate = new Date();
    let currentUser = null;
    let userNickname = "匿名人士";
    let userEmoji = "👤"; // ✅ 新增預設 Emoji
    let selectedDateStr = "";
    let myFriendsUids = [];
    let myFriendsMap = {}; // ✅ 儲存好友的詳細資料 (包含 Emoji)
    let currentViewingRecordId = null;

    // --- 時間格式化 ---
    function formatTime(timestamp) {
        if (!timestamp) return "";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    const happyOptions = ["1 (讚讚)", "2 (不錯不錯)", "3 (開心撒花)", "4 (有夠快樂)", "5 (比葳孟幸福)"];
    const angryOptions = ["1 (煩躁)", "2 (白眼)", "3 (操)", "4 (操操操)", "5 (離職幹)"];

    function updateEmotionOptions(isAngry) {
        const options = isAngry ? angryOptions : happyOptions;
        indexLabel.innerText = isAngry ? "生氣指數：" : "快樂指數：";
        emotionIndexSelect.innerHTML = "";
        options.forEach((text, i) => {
            const option = document.createElement('option');
            option.value = i + 1;
            option.innerText = text;
            emotionIndexSelect.appendChild(option);
        });
    }

    function updateStatistics(allRecords, currentYear, currentMonth) {
        let mHappy = 0, mAngry = 0, tHappy = 0, tAngry = 0;
        allRecords.forEach(rec => {
            if (rec.uid !== currentUser.uid) return;
            const val = parseInt(rec.index) || 0;
            const [y, m] = rec.date.split('-').map(Number);
            if (y === currentYear) {
                if (rec.type === 'happy') tHappy += val;
                else tAngry += val;
            }
            if (y === currentYear && m === (currentMonth + 1)) {
                if (rec.type === 'happy') mHappy += val;
                else mAngry += val;
            }
        });
        document.getElementById('month-happy-sum').innerText = mHappy;
        document.getElementById('month-angry-sum').innerText = mAngry;
        document.getElementById('total-happy-sum').innerText = tHappy;
        document.getElementById('total-angry-sum').innerText = tAngry;
    }

    async function renderCalendar() {
        calendarGrid.innerHTML = '';
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        monthDisplay.innerText = `${year}年 ${month + 1}月`;
        const currentTheme = themeSwitch.checked ? 'angry' : 'happy';

        let dailyRecords = {};
        let allRecordsForStats = [];
        
        if (currentUser && myFriendsUids.length > 0) {
            try {
                const q = query(collection(window.db, "records"), where("uid", "in", myFriendsUids));
                const snap = await getDocs(q);
                snap.forEach(doc => {
                    const data = doc.data();
                    data.id = doc.id;
                    allRecordsForStats.push(data);
                    if (!dailyRecords[data.date]) dailyRecords[data.date] = [];
                    dailyRecords[data.date].push(data);
                });
                updateStatistics(allRecordsForStats, year, month);
            } catch (e) { console.error("資料讀取失敗", e); }
        }

        const firstDay = new Date(year, month, 1).getDay();
        for (let i = 0; i < firstDay; i++) calendarGrid.appendChild(document.createElement('div'));
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        for (let day = 1; day <= daysInMonth; day++) {
            const dateDiv = document.createElement('div');
            dateDiv.classList.add('calendar-day');
            const dStr = `${year}-${month + 1}-${day}`;
            dateDiv.innerHTML = `<span>${day}</span>`;

            if (dailyRecords[dStr]) {
                dailyRecords[dStr].forEach(rec => {
                    if (rec.type === currentTheme) {
                        const icon = rec.type === 'angry' ? '🔥' : '☁️';
                        const item = document.createElement('div');
                        item.className = "record-item";
                        // ✅ 這裡使用發文時存下的或好友的 Emoji
                        const displayEmoji = rec.userEmoji || "👤";
                        item.innerText = `${icon}${displayEmoji} ${rec.userName}`;
                        item.onclick = (e) => { e.stopPropagation(); openViewModal(rec); };
                        dateDiv.appendChild(item);
                    }
                });
            }

            const targetDate = new Date(year, month, day);
            if (targetDate <= todayEnd) {
                dateDiv.classList.add('clickable');
                dateDiv.onclick = () => openEditModal(dStr);
            } else {
                dateDiv.classList.add('future-day');
            }
            calendarGrid.appendChild(dateDiv);
        }
    }

    async function fetchComments(recordId) {
        const list = document.getElementById('comments-list');
        list.innerHTML = "<p style='font-size:0.8rem; opacity:0.6;'>載入留言中...</p>";
        try {
            const q = query(collection(window.db, "records", recordId, "comments"), orderBy("createdAt", "asc"));
            const snap = await getDocs(q);
            renderCommentItems(snap);
        } catch (e) { 
            const snap = await getDocs(collection(window.db, "records", recordId, "comments"));
            renderCommentItems(snap);
        }
    }

    function renderCommentItems(snap) {
        const list = document.getElementById('comments-list');
        list.innerHTML = snap.empty ? "<p style='font-size:0.8rem; color:#999; text-align:center;'>還沒有回覆唷...</p>" : "";
        snap.forEach(doc => {
            const data = doc.data();
            const div = document.createElement('div');
            const isMine = data.uid === currentUser.uid;
            // ✅ 加入時間顯示
            const timeStr = formatTime(data.createdAt);
            div.className = `comment-bubble ${isMine ? 'my-comment' : ''}`;
            div.innerHTML = `
                <span class="comment-user">${data.userEmoji || "👤"} ${data.userName}:</span> 
                ${data.text}
                <div style="font-size: 0.6rem; opacity: 0.5; margin-top: 4px; text-align: right;">${timeStr}</div>
            `;
            list.appendChild(div);
        });
        list.scrollTop = list.scrollHeight;
    }

    document.getElementById('submit-comment-btn').onclick = async () => {
        const input = document.getElementById('new-comment-input');
        if (!input.value.trim() || !currentViewingRecordId) return;
        try {
            await addDoc(collection(window.db, "records", currentViewingRecordId, "comments"), {
                text: input.value, uid: currentUser.uid, userName: userNickname, userEmoji: userEmoji, createdAt: new Date()
            });
            input.value = "";
            fetchComments(currentViewingRecordId);
        } catch (e) { alert("留言失敗"); }
    };

    saveRecordBtn.onclick = async () => {
        const title = document.getElementById('record-title').value;
        const content = document.getElementById('record-content').value;
        if (!title) return alert("請填寫標題");
        try {
            await addDoc(collection(window.db, "records"), {
                uid: currentUser.uid, userName: userNickname, userEmoji: userEmoji, date: selectedDateStr,
                type: themeSwitch.checked ? 'angry' : 'happy', title, content,
                index: emotionIndexSelect.value, createdAt: new Date()
            });
            modal.classList.add('hidden');
            renderCalendar();
        } catch (e) { alert("儲存失敗"); }
    };

    loginBtn.onclick = () => signInWithPopup(window.auth, new GoogleAuthProvider());
    document.getElementById('logout-btn').onclick = () => signOut(window.auth);
    
    saveNicknameBtn.onclick = async () => {
        const val = nicknameInput.value.trim();
        const emo = emojiInput.value.trim() || "👤";
        await setDoc(doc(window.db, "users", currentUser.uid), { nickname: val, emoji: emo });
        userNickname = val;
        userEmoji = emo;
        alert("設定已更新！");
        fetchFriendsAndData();
    };

    addFriendBtn.onclick = async () => {
        const name = friendSearchInput.value.trim();
        if (!name || name === userNickname) return;
        const q = query(collection(window.db, "users"), where("nickname", "==", name));
        const snap = await getDocs(q);
        if (snap.empty) return alert("找不到人");
        await setDoc(doc(window.db, "users", currentUser.uid, "friends", snap.docs[0].id), { nickname: name });
        alert("成功添加好友！");
        fetchFriendsAndData();
    };

    function openEditModal(dateStr) {
        selectedDateStr = dateStr; currentViewingRecordId = null;
        document.getElementById('modal-date-title').innerText = dateStr + " (寫日記)";
        editView.classList.remove('hidden'); detailView.classList.add('hidden');
        commentSection.classList.add('hidden'); saveRecordBtn.classList.remove('hidden');
        updateEmotionOptions(themeSwitch.checked); modal.classList.remove('hidden');
    }
    
    function openViewModal(record) {
        currentViewingRecordId = record.id;
        document.getElementById('modal-date-title').innerText = record.date;
        editView.classList.add('hidden'); detailView.classList.remove('hidden');
        commentSection.classList.remove('hidden'); saveRecordBtn.classList.add('hidden');
        document.getElementById('view-title').innerText = record.title;
        document.getElementById('view-time').innerText = "發布於: " + formatTime(record.createdAt);
        document.getElementById('view-content').innerText = record.content;
        fetchComments(record.id); modal.classList.remove('hidden');
    }

    document.getElementById('close-modal').onclick = () => modal.classList.add('hidden');
    document.getElementById('prevMonth').onclick = () => { currentDate.setMonth(currentDate.getMonth()-1); renderCalendar(); };
    document.getElementById('nextMonth').onclick = () => { currentDate.setMonth(currentDate.getMonth()+1); renderCalendar(); };

    themeSwitch.onchange = () => {
        const isAngry = themeSwitch.checked;
        document.documentElement.className = isAngry ? 'theme-angry' : 'theme-happy';
        updateEmotionOptions(isAngry);
        renderCalendar();
    };

    async function fetchFriendsAndData() {
        if (!currentUser) return;
        myFriendsUids = [currentUser.uid];
        myFriendsMap = {};
        friendsListUI.innerHTML = "";

        const snap = await getDocs(collection(window.db, "users", currentUser.uid, "friends"));
        
        // 抓取好友的詳細資料 (包含最新 Emoji)
        for (const fDoc of snap.docs) {
            const friendId = fDoc.id;
            const friendSnap = await getDoc(doc(window.db, "users", friendId));
            if (friendSnap.exists()) {
                const data = friendSnap.data();
                myFriendsUids.push(friendId);
                myFriendsMap[friendId] = data;
                
                const li = document.createElement('li');
                li.innerText = `${data.emoji || "👤"} ${data.nickname}`;
                friendsListUI.appendChild(li);
            }
        }
        renderCalendar();
    }

    onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            currentUser = user;
            loginBtn.classList.add('hidden'); userInfo.classList.remove('hidden'); friendsSection.classList.remove('hidden');
            document.getElementById('user-photo').src = user.photoURL;
            const uDoc = await getDoc(doc(window.db, "users", user.uid));
            if (uDoc.exists()) {
                const data = uDoc.data();
                userNickname = data.nickname;
                userEmoji = data.emoji || "👤";
                nicknameInput.value = userNickname;
                emojiInput.value = userEmoji;
            }
            fetchFriendsAndData();
        } else {
            currentUser = null;
            loginBtn.classList.remove('hidden'); userInfo.classList.add('hidden'); friendsSection.classList.add('hidden');
            renderCalendar();
        }
    });

    updateEmotionOptions(false);
}

startApp();