/**
 * 뒤로 가기(안드로이드 뒤로 버튼·브라우저 뒤로)를 화면 단위로 처리한다.
 *
 * 화면/시트를 열 때 history 항목을 하나 쌓고, 뒤로 가기가 오면 가장 위의 처리기를 부른다.
 * Capacitor는 뒤로 버튼 리스너가 없으면 WebView history.back()을 호출하므로
 * 웹과 네이티브가 같은 경로를 탄다.
 *
 * history.back()은 비동기라서, 직접 닫은 직후 새 화면을 열면(pushState는 동기) 순서가 꼬인다.
 * 그래서 돌아가는 중인 back이 끝날 때까지 새 pushState를 미뤄 둔다.
 */
const stack: (() => void)[] = [];
let pendingBacks = 0;
let queuedPushes = 0;

window.addEventListener('popstate', () => {
  if (pendingBacks > 0) {
    pendingBacks -= 1;
    if (pendingBacks === 0) {
      for (; queuedPushes > 0; queuedPushes -= 1) history.pushState({ pocket: true }, '');
    }
    return;
  }
  stack.pop()?.();
});

function push(): void {
  if (pendingBacks > 0) queuedPushes += 1;
  else history.pushState({ pocket: true }, '');
}

function popSilently(): void {
  // 아직 쌓지 못한 항목이면 미뤄 둔 push 하나를 취소하는 것으로 끝난다.
  if (queuedPushes > 0) {
    queuedPushes -= 1;
    return;
  }
  pendingBacks += 1;
  history.back();
}

/** 처리기를 등록한다. 돌려받은 함수로 (뒤로 가기 없이) 직접 닫을 때 기록을 정리한다. */
export function onBack(handler: () => void): () => void {
  stack.push(handler);
  push();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = stack.lastIndexOf(handler);
    if (i < 0) return;
    stack.splice(i, 1);
    popSilently();
  };
}

/** 처리기가 뒤로 가기로 불렸을 때도 dismiss 를 안전하게 부를 수 있도록 감싼다. */
export function backScope(close: () => void): { dismiss: () => void } {
  let dismissed = false;
  const remove = onBack(() => {
    dismissed = true;
    close();
  });
  return {
    dismiss: () => {
      if (dismissed) return;
      dismissed = true;
      remove();
    },
  };
}
