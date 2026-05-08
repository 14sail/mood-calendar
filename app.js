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

    // --- UI 元素 ---
    const themeSwitch = document.getElementById('themeSwitch');
    const calendarGrid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('monthDisplay');
    const modal = document.getElementById('modal-overlay');
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');
    const nicknameInput = document.getElementById('nickname-input');
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

    // --- 狀態變數 ---
    let currentDate = new Date();
    let currentUser = null;
    let userNickname = "匿名人士";
    let selectedDateStr = "";
    let myFriendsUids = [];
    let myFriendsData = []; // ✅ Bug 1 修正：新增儲存好友資料（含暱稱）的陣列
    let currentViewingRecordId = null;

    // --- 指數描述 ---
    const happyOptions = ["1 (讚讚)", "2 (不錯不錯)", "3 (開心撒花)", "4 (有夠快樂)", "5 (比葳孟幸福)"];
    const angryOptions = ["1 (煩躁)", "2 (白眼)", "3 (操)", "4 (操操操)", "5 (離職幹)"];

    // ✅ Bug 3 修正：updateEmotionOptions 同時更新 index-label
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

    // ✅ Bug 2 修正：總計改為只統計「當年度」，與標籤「年度累計」一致
    function updateStatistics(allRecords, currentYear, currentMonth) {
        let mHappy = 0, mAngry = 0, tHappy = 0, tAngry = 0;

        allRecords.forEach(rec => {
            if (rec.uid !== currentUser.uid) return;

            const val = parseInt(rec.index) || 0;
            const [y, m] = rec.date.split('-').map(Number);

            // 年度累計：只統計今年的資料
            if (y === currentYear) {
                if (rec.type === 'happy') tHappy += val;
                else tAngry += val;
            }

            // 本月統計
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

    // --- 渲染與資料抓取 ---
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

        // ✅ Bug 4 修正：在迴圈外設定一次 todayEnd，避免在每次迭代中 mutate 物件
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
                        item.innerText = `${icon} ${rec.userName}`;
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

    // --- 留言系統 ---
    async function fetchComments(recordId) {
        const list = document.getElementById('comments-list');
        list.innerHTML = "<p style='font-size:0.8rem; opacity:0.6;'>載入留言中...</p>";
        try {
            const q = query(collection(window.db, "records", recordId, "comments"), orderBy("createdAt", "asc"));
            const snap = await getDocs(q);
            renderCommentItems(snap);
        } catch (e) { 
            console.warn("排序讀取失敗，改用無排序模式", e);
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
            div.className = `comment-bubble ${isMine ? 'my-comment' : ''}`;
            div.innerHTML = `<span class="comment-user">${data.userName}:</span> ${data.text}`;
            list.appendChild(div);
        });
        list.scrollTop = list.scrollHeight;
    }

    // --- 按鈕動作綁定 ---
    document.getElementById('submit-comment-btn').onclick = async () => {
        const input = document.getElementById('new-comment-input');
        if (!input.value.trim() || !currentViewingRecordId) return;
        try {
            await addDoc(collection(window.db, "records", currentViewingRecordId, "comments"), {
                text: input.value, uid: currentUser.uid, userName: userNickname, createdAt: new Date()
            });
            input.value = "";
            fetchComments(currentViewingRecordId);
        } catch (e) { 
            console.error("留言寫入失敗：", e); 
            alert("留言失敗，請稍後再試"); 
        }
    };

    saveRecordBtn.onclick = async () => {
        const title = document.getElementById('record-title').value;
        const content = document.getElementById('record-content').value;
        if (!title) return alert("請填寫標題");
        try {
            await addDoc(collection(window.db, "records"), {
                uid: currentUser.uid, userName: userNickname, date: selectedDateStr,
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
        await setDoc(doc(window.db, "users", currentUser.uid), { nickname: val });
        userNickname = val;
        alert("暱稱已更新！");
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
        document.getElementById('view-content').innerText = record.content;
        fetchComments(record.id); modal.classList.remove('hidden');
    }

    document.getElementById('close-modal').onclick = () => modal.classList.add('hidden');
    document.getElementById('prevMonth').onclick = () => { currentDate.setMonth(currentDate.getMonth()-1); renderCalendar(); };
    document.getElementById('nextMonth').onclick = () => { currentDate.setMonth(currentDate.getMonth()+1); renderCalendar(); };

    themeSwitch.onchange = () => {
        const isAngry = themeSwitch.checked;
        document.documentElement.className = isAngry ? 'theme-angry' : 'theme-happy';
        // ✅ Bug 3 修正：label 更新移至 updateEmotionOptions，這裡不再重複設定
        updateEmotionOptions(isAngry);
        renderCalendar();
    };

    // ✅ Bug 1 修正：fetchFriendsAndData 現在會把好友暱稱渲染進 #friends-list
    async function fetchFriendsAndData() {
        if (!currentUser) return;
        myFriendsUids = [currentUser.uid];
        myFriendsData = [];

        const snap = await getDocs(collection(window.db, "users", currentUser.uid, "friends"));
        snap.forEach(friendDoc => {
            myFriendsUids.push(friendDoc.id);
            myFriendsData.push({ uid: friendDoc.id, nickname: friendDoc.data().nickname });
        });

        // 渲染好友列表 UI
        friendsListUI.innerHTML = "";
        myFriendsData.forEach(friend => {
            const li = document.createElement('li');
            li.innerText = `👤 ${friend.nickname}`;
            friendsListUI.appendChild(li);
        });

        renderCalendar();
    }

    onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            currentUser = user;
            loginBtn.classList.add('hidden'); userInfo.classList.remove('hidden'); friendsSection.classList.remove('hidden');
            document.getElementById('user-photo').src = user.photoURL;
            const uDoc = await getDoc(doc(window.db, "users", user.uid));
            userNickname = uDoc.exists() ? uDoc.data().nickname : "新成員";
            nicknameInput.value = userNickname;
            fetchFriendsAndData();
        } else {
            currentUser = null;
            loginBtn.classList.remove('hidden'); userInfo.classList.add('hidden'); friendsSection.classList.add('hidden');
            renderCalendar();
        }
    });

    // ✅ Bug 3 修正：初始化時呼叫 updateEmotionOptions，label 已在函式內一起設定
    updateEmotionOptions(false);
}

startApp();