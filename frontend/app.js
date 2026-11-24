const API = '/api';

let user = null;
let topics = [];
let questions = [];
let qi = 0;
let selected = null;
let answers = [];
let topic = null;
let timerId = null;
let secondsRemaining = 30;
let questionProcessed = false;
let advancing = false;
let quizFinished = false;
const timerDisplay = document.getElementById('timer');
const nextButton = document.getElementById('next');

const views = ['home', 'login', 'register', 'topics', 'quiz', 'result', 'history', 'admin'];

function view(v) {
  if (v !== 'quiz') stopTimer();
  views.forEach((x) => document.getElementById(x).classList.toggle('hidden', x !== v));
  msg('');
  nav();

  if (v === 'topics') loadTopics();
  if (v === 'history') loadHistory();
  if (v === 'admin') loadAdmin();
}

function msg(t, err = false) {
  document.getElementById('msg').innerHTML = t
    ? `<p style="padding:10px;background:${err ? '#fee2e2' : '#e0f2fe'}">${esc(t)}</p>`
    : '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

async function api(p, opt = {}) {
  let r = await fetch(API + p, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opt
  });

  let d = {};
  try {
    d = await r.json();
  } catch (e) {}

  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

function nav() {
  let n = document.getElementById('nav');

  n.innerHTML = user
    ? `<button class="secondary" onclick="view('topics')">Quizzes</button>
       <button class="secondary" onclick="view('history')">History</button>
       ${user.role === 'admin' ? '<button onclick="view(\'admin\')">Admin</button>' : ''}
       <span>${esc(user.name)}</span>
       <button onclick="logout()">Logout</button>`
    : `<button class="secondary" onclick="view('login')">Login</button>
       <button onclick="view('register')">Register</button>`;
}

async function refresh() {
  try {
    user = (await api('/auth/me')).user;
  } catch (e) {
    user = null;
  }
  nav();
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  user = null;
  view('home');
}

loginForm.onsubmit = async (e) => {
  e.preventDefault();

  try {
    let d = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: loginEmail.value,
        password: loginPassword.value
      })
    });

    user = d.user;
    view('topics');
    msg('Login successful');
  } catch (e) {
    msg(e.message, true);
  }
};

registerForm.onsubmit = async (e) => {
  e.preventDefault();

  try {
    let d = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: registerName.value,
        email: registerEmail.value,
        password: registerPassword.value
      })
    });

    user = d.user;
    view('topics');
    msg('Account created');
  } catch (e) {
    msg(e.message, true);
  }
};

async function loadTopics() {
  try {
    topics = (await api('/topics')).topics;

    topicGrid.innerHTML =
      topics
        .map((t, i) => `
          <div class="topic">
            <div style="font-size:30px">${['🧩', '💻', '🌍', '📘'][i % 4]}</div>
            <h3>${esc(t.name)}</h3>
            <p>${esc(t.description || 'Practice this topic.')}</p>
            <p>${t.question_count} questions</p>
            <button onclick="start(${t.id})" ${t.question_count === 0 ? 'disabled' : ''}>
              Start quiz
            </button>
          </div>
        `)
        .join('') || 'No topics yet';
  } catch (e) {
    msg(e.message, true);
  }
}

async function start(id) {
  if (!user) {
    view('login');
    msg('Please login first');
    return;
  }

  try {
    stopTimer();
    let d = await api('/topics/' + id + '/quiz');
    questions = shuffleArray(d.questions.slice()).map((q) => {
      let shuffledOptions = shuffleArray(
        q.options.map((option, index) => ({ option, index }))
      );

      return {
        ...q,
        options: shuffledOptions.map((item) => item.option),
        correct_index: shuffledOptions.findIndex((item) => item.index === q.correct_index)
      };
    });
    topic = d.topic;

    if (!questions.length) {
      msg('No questions in this topic');
      return;
    }

    qi = 0;
    answers = Array(questions.length).fill(null);
    quizFinished = false;
    view('quiz');
    renderQ();
  } catch (e) {
    msg(e.message, true);
  }
}

function shuffleArray(items) {
  for (let i = items.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer() {
  stopTimer();
  secondsRemaining = 30;
  timerDisplay.textContent = `Time remaining: ${secondsRemaining}s`;
  timerDisplay.classList.remove('urgent');

  timerId = setInterval(() => {
    if (questionProcessed) {
      stopTimer();
      return;
    }

    secondsRemaining = Math.max(secondsRemaining - 1, 0);
    timerDisplay.textContent = `Time remaining: ${secondsRemaining}s`;
    timerDisplay.classList.toggle('urgent', secondsRemaining <= 5);

    if (secondsRemaining === 0) {
      stopTimer();
      timeoutQuestion();
    }
  }, 1000);
}

function renderQ() {
  selected = null;
  questionProcessed = false;
  advancing = false;

  let q = questions[qi];
  progress.textContent = `Question ${qi + 1} / ${questions.length}`;
  bar.style.width = (qi / questions.length * 100) + '%';
  qtext.textContent = q.question;

  opts.innerHTML = q.options
    .map(
      (o, i) => `
        <label class="option" id="o${i}" onclick="pick(${i})">
          <input type="radio" name="ans" value="${i}"> <b>${'ABCD'[i]}.</b> ${esc(o)}
        </label>
      `
    )
    .join('');

  exp.classList.add('hidden');
  check.classList.remove('hidden');
  nextButton.classList.add('hidden');
  startTimer();
}

function pick(i) {
  if (questionProcessed || check.classList.contains('hidden')) return;

  selected = i;
  document.querySelectorAll('.option').forEach((x) => x.classList.remove('selected'));
  document.getElementById('o' + i).classList.add('selected');
  document.querySelector(`#o${i} input`).checked = true;
}

function checkAnswer() {
  if (questionProcessed) return;

  if (selected === null) {
    msg('Select an answer first');
    return;
  }

  questionProcessed = true;
  stopTimer();

  let q = questions[qi];
  let correct = selected === q.correct_index;

  answers[qi] = {
    question_id: q.id,
    selected_option: selected,
    correct
  };

  document.querySelectorAll('.option').forEach((o, i) => {
    if (i === q.correct_index) o.classList.add('correct');
    else if (i === selected) o.classList.add('wrong');
  });

  exp.innerHTML = `<b>${correct ? 'Correct! 🎉' : 'Not quite.'}</b><br>${esc(q.explanation)}`;
  exp.classList.remove('hidden');
  check.classList.add('hidden');
  nextButton.classList.remove('hidden');
  bar.style.width = ((qi + 1) / questions.length * 100) + '%';
}

function timeoutQuestion() {
  if (questionProcessed || quizFinished) return;

  questionProcessed = true;
  answers[qi] = {
    question_id: questions[qi].id,
    selected_option: null,
    correct: false
  };
  advanceQuestion();
}

async function next() {
  await advanceQuestion();
}

async function advanceQuestion() {
  if (!questionProcessed || advancing || quizFinished) return;
  advancing = true;
  qi++;

  if (qi < questions.length) {
    renderQ();
    return;
  }

  await finishQuiz();
}

async function finishQuiz() {
  if (quizFinished) return;
  quizFinished = true;
  stopTimer();

  let score = Math.min(answers.filter((a) => a && a.correct).length, questions.length);
  let unanswered = answers.filter((a) => a && a.selected_option === null).length;
  let incorrect = questions.length - score - unanswered;
  let percentage = questions.length ? Math.round((score / questions.length) * 100) : 0;
  let saveError = null;

  try {
    await api('/results', {
      method: 'POST',
      body: JSON.stringify({
        topic_id: topic.id,
        score,
        total: questions.length,
        answers
      })
    });
  } catch (e) {
    saveError = e.message;
  }

  resultTitle.textContent = topic.name;
  document.getElementById('score').textContent = `${score} / ${questions.length}`;
  resultMsg.textContent = `Correct: ${score} · Incorrect: ${incorrect} · Unanswered: ${unanswered} · ${percentage}%`;
  view('result');
  if (saveError) msg(`Quiz finished, but the result could not be saved: ${saveError}`, true);
}

async function loadHistory() {
  if (!user) {
    view('login');
    return;
  }

  try {
    let d = await api('/history');

    historyList.innerHTML = d.history.length
      ? d.history
          .map(
            (h) => `
              <div class="row">
                <div>
                  <b>${esc(h.topic_name)}</b>
                  <p>${new Date(h.created_at).toLocaleString()}</p>
                </div>
                <b>${h.score}/${h.total}</b>
              </div>
            `
          )
          .join('')
      : 'No quiz attempts yet.';
  } catch (e) {
    msg(e.message, true);
  }
}

topicForm.onsubmit = async (e) => {
  e.preventDefault();

  try {
    await api('/admin/topics', {
      method: 'POST',
      body: JSON.stringify({
        name: topicName.value,
        description: topicDescription.value
      })
    });

    topicName.value = '';
    topicDescription.value = '';
    msg('Topic created');
    loadAdmin();
  } catch (e) {
    msg(e.message, true);
  }
};

questionForm.onsubmit = async (e) => {
  e.preventDefault();

  let options = [option0.value, option1.value, option2.value, option3.value];

  try {
    await api('/admin/questions', {
      method: 'POST',
      body: JSON.stringify({
        topic_id: +questionTopic.value,
        question: questionTextInput.value,
        options,
        correct_index: +correctIndex.value,
        explanation: questionExplanation.value
      })
    });

    questionForm.reset();
    msg('Question added');
  } catch (e) {
    msg(e.message, true);
  }
};

async function loadAdmin() {
  if (!user || user.role !== 'admin') {
    view('topics');
    msg('Admin access only', true);
    return;
  }

  try {
    topics = (await api('/topics')).topics;

    questionTopic.innerHTML = topics
      .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`)
      .join('');

    adminTopics.innerHTML = topics
      .map(
        (t) => `
          <div class="row">
            <span>${esc(t.name)} (${t.question_count} questions)</span>
            <button onclick="delTopic(${t.id})">Delete</button>
          </div>
        `
      )
      .join('');
  } catch (e) {
    msg(e.message, true);
  }
}

async function delTopic(id) {
  if (!confirm('Delete this topic and its questions?')) return;

  try {
    await api('/admin/topics/' + id, { method: 'DELETE' });
    loadAdmin();
    msg('Topic deleted');
  } catch (e) {
    msg(e.message, true);
  }
}

refresh();
view('home');
