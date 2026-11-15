import {
  type Content,
  type FunctionDeclaration,
  GoogleGenAI,
  type Part,
  Type,
} from '@google/genai';
import type { AnswerAttachment, AppState, ReviewProgressEvent } from '../types.ts';
import { blobToBase64 } from '../utils/imageProcessor.ts';
import { getApiKey, getTodayJST, loadState } from './storeService.ts';
import {
  createSessionTracker,
  executeAITool,
  type ReviewSessionTracker,
} from './toolExecutor.ts';

function formatGeminiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('400')) {
    if (msg.includes('API')) {
      return 'APIキーが無効です。「環境設定」のAPIキー欄を確認してください。';
    }
  }
  if (msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return 'APIキーの権限がありません。Google AI Studio でキーの状態を確認してください。';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return 'APIの利用上限（レート制限）に達しました。しばらく時間を置いてから再試行してください。';
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    return '指定されたGeminiモデルが見つかりませんでした。';
  }
  return msg || '添削処理中にエラーが発生しました。';
}

export async function testApiKeyConnection(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const clean = apiKey.trim();
  if (!clean) {
    return { ok: false, message: 'APIキーを入力してください。' };
  }
  try {
    const ai = new GoogleGenAI({ apiKey: clean });
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: '接続テストです。「OK」とだけ返してください。',
    });
    if (response.text) {
      return { ok: true, message: '接続に成功しました。Gemini API が利用可能です。' };
    }
    return { ok: false, message: '応答が空でした。APIキーの設定を確認してください。' };
  } catch (err) {
    return { ok: false, message: formatGeminiError(err) };
  }
}

function buildSystemPrompt(state: AppState): string {
  const today = getTodayJST();
  const subjects = state.subjects.join(', ');
  const mode = state.mode;

  return `あなたは、大学受験生の答案を添削するチューターです。
ユーザーは答案の写真（複数ページの画像を含む）またはPDFを送ります。答案を読み取り、添削し、
復習に必要な内容をアプリに登録してください。

■ 現在の状況
・今日の日付: ${today}
・ユーザーが作成した科目: ${subjects}
・整理モード: ${mode}   （一任 または 確認）

■ 作業の手順
1. 答案から科目を判断する。${subjects} にない科目は勝手に作らず、
   ユーザーに「どの科目に入れますか？」と質問して、返事を待つ。
2. get_tendencies と get_tree を呼び、過去の傾向と既存の構成を確認する。
   単元フォルダの中身が必要なときだけ、さらに get_tree や read_file を呼ぶ。
   独立した呼び出しは1回の応答で並列にまとめて返すこと。
3. 問題ごとに採点し、誤りの原因を判断する。
4. 登録する。
   ・知識不足 → save_file
   ・不注意 → record_tendency
5. 必要なら整理（create_folder / move_item / rename_item / merge_items）。
6. 最後に finalize_review を1回だけ呼ぶ。
   ユーザーに見せる添削コメントは、この呼び出しの内容がそのまま表示される。
   ツール呼び出しの外に、添削コメントの文章を書かない。
   通常の文章で返してよいのは、ユーザーへの確認質問のときだけ。

■ 採点の基準
・模範解答が答案と一緒に写っている場合は、それを参考に照合する。
  模範解答が不完全に見えるときだけ、自分の解釈で補う。
  basis は "model_answer" とする。
・模範解答がない場合は、自分で解いて採点する。basis は "ai_grading" とする。
・採点に自信が持てない問題は、登録をしない。confidence_low を true にして、
  その旨をコメントで伝える。
・記述問題は点数でなく、要素ごとに満たしているかで評価する。
・読み取れない文字がある場合も、最善の読み取りで採点してよい。
  ただし、誤りの箇所には、読み取った内容を文字で引用すること。
・複数の画像が添付されている場合は、送られた順番（1ページ目、2ページ目…）に
  1つの答案の複数ページとして通しで読み取ること。

■ 原因の区分（最重要）
誤りの原因は、次のどれかに分ける。
・知識不足（knowledge）: 知らない、覚えていない、理解していない。
・不注意（carelessness）: 知っているはずなのに、ミスで落とした。
  例: 符号ミス、写し間違い、文字の書き間違い、スペルミス、
      条件の読み落とし、単位の付け忘れ、答えの出し忘れ。
・両方（both）、誤りなし（none）。
判断の手がかり:
・同じ答案の中で正しく使えている箇所があれば、不注意と判断する。
・一貫して誤っていれば、知識不足と判断する。
・get_tree で既存の知識項目にある内容なら、知識不足寄りに考える。
・その科目で同じ事柄を正しく使えた実績があれば、不注意寄りに考える。
・どうしても迷うときだけ、登録せずにユーザーへ一言で確認する。
  （例:「このスペルは覚えていなかった？ それとも書き間違い？」）
  確認は、迷いが大きいときだけ行う。毎回は聞かない。

■ 知識項目（save_file）のルール
・見出しは短く、具体的に書く。例: 「3倍角の公式」「If it were not for 〜」「あいなし」
・解説は1〜2行で簡潔に。数式は LaTeX 記法で \\( ... \\) のように書く。
・1回の添削で登録する知識項目は、原因として本質的なものに絞る（最大5件）。
・登録の前に、get_tree で既存の見出しを確認する。同じ意味の見出しが
  既にあれば、その見出しをそのまま使う（表記ゆれを作らない）。
・既存の見出しなら、解説の書き換えはせず、ミス回数が加算される。
・関連する単元は、適切な単元フォルダに入れることで表現する。
  フォルダは、科目の下に最大2段まで。単元名は教科書の章のレベルにする。
  既存のフォルダに合うものがあれば、新しく作らず、それを使う。

■ 傾向（record_tendency）のルール
・対象は、不注意によるミスだけ。知識不足は入れない。
・分類は次から選ぶ: 計算 / 転記 / 読解 / 表記 / 最終確認
・傾向名は、原因が分かる具体的な名前にする。
  例: 「移項時の符号の落とし」「問題文の条件の読み落とし」「英単語のスペルミス」
  「ケアレスミス」のような広すぎる名前は使わない。
・get_tendencies の結果に近い傾向があれば、その傾向を使う。
  科目が違っても、同じ種類のミスなら同じ傾向として記録する。
・situation には、どんな場面で起きたかを一言で書く。

■ 整理のルール
・整理してよいのは、フォルダの作成、項目の移動、名前の変更、類似項目の統合。
・削除は、できない。科目の作成・変更・削除も、できない。
・整理は、添削のついでに軽く行う。大規模な整理を始めない。
・確認モードのときは、整理の依頼が「提案」として保留される。
  その場合でも、ユーザーに確認を求める文章は書かなくてよい（アプリが通知欄に出す）。
・同じ内容を、何度も提案しない。

■ 科目ごとの整理の方針
・数学: 単元は教科書の章（例: 三角関数、数列、微分積分）。公式・定理は知識項目。
        計算・符号・転記のミスは傾向。
・英語: 単元は文法項目（例: 仮定法、関係詞、不定詞）、語彙、構文、長文読解。
        スペルミスは傾向、知らなかった表現は知識項目。
・国語: 古文単語・古典文法・漢文句法・漢字・現代文の読解法などに分ける。
        設問の取り違えは傾向。
・理科: 公式・法則・現象を知識項目にする。単位・有効数字・符号は傾向。
・社会: 用語・年代・制度を知識項目にする。人名や用語の書き間違いは傾向。
・上記以外の科目も、同様に、教科書の章で単元を分ける。

■ 添削コメントの書き方（finalize_review）
・結果: 問題ごとに、正解 / 部分点 / 不正解 と、判定の根拠。
・誤りの箇所: 読み取った答案の該当部分を引用して、どこが誤りかを具体的に指摘する。
・原因: 知識不足なら登録した見出し、不注意なら登録した傾向名を示す。
・過去との関連: get_tendencies の結果に基づき、該当するときだけ一言添える。
  例:「この符号ミスは、数学で直近3回出ています」
・ひとこと（note）: 別解、書き方の助言、優先度など、型に収まらないことを
  3〜4文以内で書く。ここに書いた内容は登録されない。
・問題が複数あるときは、結果と誤りの箇所を問題ごとに繰り返し、
  過去との関連とひとことは全体で1回にまとめる。
・該当しない項目は省略する（全問正解なら、結果とひとことだけでよい）。
・次にやることは、1〜2個に絞る。
・丁寧だが簡潔に。ユーザーを責めず、事実と次の一手を示す。

■ してはいけないこと
・削除、科目の作成・変更。
・既存の項目の解説の書き換え。
・知識不足を、傾向として登録すること。
・自信のない採点に基づく登録。
・ツールの外に、添削コメントを書くこと。
・ユーザーの氏名や学校名などの個人情報を、見出し・解説・状況に書くこと。`;
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_tree',
    description:
      '指定した科目またはフォルダの直下にある、子フォルダ名と知識項目の見出し一覧を返す。本文（解説）は返さない。保存や整理の前に、既存の構成と見出しを確認するために使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        folder_path: {
          type: Type.STRING,
          description: '科目名、または科目名から始まるフォルダのパス。例: "数学"、"数学/三角関数"',
        },
      },
      required: ['folder_path'],
    },
  },
  {
    name: 'read_file',
    description: '指定した知識項目の解説とミス回数を返す。既存の項目と照合したいときに使う。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        folder_path: {
          type: Type.STRING,
          description: '項目が入っているフォルダのパス',
        },
        heading: {
          type: Type.STRING,
          description: '項目の見出し',
        },
      },
      required: ['folder_path', 'heading'],
    },
  },
  {
    name: 'save_file',
    description:
      '知識不足と判断した内容を、知識項目として登録する。同じフォルダに同じ見出しがある場合は、解説を書き換えず、ミス回数だけを1加算する。不注意によるミスには使わない（その場合は record_tendency を使う）。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        folder_path: {
          type: Type.STRING,
          description: '登録先のフォルダのパス（科目の下の単元フォルダ）。存在しない単元フォルダは、自動で作成される。',
        },
        heading: {
          type: Type.STRING,
          description: '項目の見出し。40文字以内。短く具体的に。既存の見出しがあればそのまま使う。',
        },
        explanation: {
          type: Type.STRING,
          description: '解説。1〜2行、200文字以内。数式はLaTeX記法で \\( ... \\) と書く。',
        },
      },
      required: ['folder_path', 'heading', 'explanation'],
    },
  },
  {
    name: 'create_folder',
    description:
      '科目の下に、単元フォルダまたは子フォルダを作成する。科目フォルダそのものは作成できない。階層は科目の下に最大2段まで。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        folder_path: {
          type: Type.STRING,
          description: '作成するフォルダのパス。例: "数学/数列"',
        },
      },
      required: ['folder_path'],
    },
  },
  {
    name: 'move_item',
    description: '知識項目、またはフォルダを、別のフォルダへ移動する。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from_path: {
          type: Type.STRING,
          description: '移動元。項目なら「フォルダのパス/見出し」、フォルダならフォルダのパス',
        },
        to_folder_path: {
          type: Type.STRING,
          description: '移動先のフォルダのパス',
        },
        reason: {
          type: Type.STRING,
          description: '移動の理由。60文字以内。提案として保留される場合に、ユーザーへ表示される。',
        },
      },
      required: ['from_path', 'to_folder_path', 'reason'],
    },
  },
  {
    name: 'rename_item',
    description: '知識項目の見出し、またはフォルダ名を変更する。科目名は変更できない。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: '対象。項目なら「フォルダのパス/見出し」、フォルダならフォルダのパス',
        },
        new_name: {
          type: Type.STRING,
          description: '新しい名前。40文字以内',
        },
        reason: {
          type: Type.STRING,
          description: '変更の理由。60文字以内',
        },
      },
      required: ['path', 'new_name', 'reason'],
    },
  },
  {
    name: 'merge_items',
    description:
      '意味が同じ、または非常に近い2つの知識項目を統合する。統合元のミス回数を統合先に合算し、統合元は削除せずに非表示にする（履歴から復元できる）。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from_path: {
          type: Type.STRING,
          description: '統合元。「フォルダのパス/見出し」',
        },
        into_path: {
          type: Type.STRING,
          description: '統合先。「フォルダのパス/見出し」。こちらの見出しと解説が残る。',
        },
        reason: {
          type: Type.STRING,
          description: '統合の理由。60文字以内',
        },
      },
      required: ['from_path', 'into_path', 'reason'],
    },
  },
  {
    name: 'get_tendencies',
    description:
      '登録済みの不注意ミスの傾向を返す。科目を指定すると、その科目で発生した傾向を返す。省略すると全科目。科目をまたぐ共通の傾向があるか確認するため、添削の最初に呼ぶ。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: {
          type: Type.STRING,
          description: '科目名。省略すると全科目。',
        },
      },
    },
  },
  {
    name: 'record_tendency',
    description:
      '不注意によるミスの傾向を記録する。既存の傾向に当てはまる場合は tendency_id を指定し、当てはまらない場合のみ new_name で新規作成する。知識不足は記録しない。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tendency_id: {
          type: Type.STRING,
          description: '既存の傾向のid。get_tendencies の結果から選ぶ。',
        },
        new_name: {
          type: Type.STRING,
          description: '新規作成する傾向名。30文字以内。原因が分かる具体的な名前にする。',
        },
        category: {
          type: Type.STRING,
          enum: ['計算', '転記', '読解', '表記', '最終確認'],
          description: '分類。新規作成時に必須。',
        },
        subject: {
          type: Type.STRING,
          description: 'このミスが起きた科目',
        },
        unit: {
          type: Type.STRING,
          description: 'このミスが起きた単元。例: 二次関数',
        },
        situation: {
          type: Type.STRING,
          description: 'どんな場面で起きたかを一言で。60文字以内。',
        },
      },
      required: ['subject', 'unit', 'situation'],
    },
  },
  {
    name: 'finalize_review',
    description:
      '添削を完了し、ユーザーに表示する添削コメントを確定する。1回の添削につき、最後に1回だけ呼ぶ。この内容が、アプリの画面にそのまま表示され、履歴に保存される。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subject: {
          type: Type.STRING,
          description: '科目名',
        },
        basis: {
          type: Type.STRING,
          enum: ['model_answer', 'ai_grading'],
          description: '採点の根拠。model_answer: 模範解答を参考にした。ai_grading: AIが自力で解いて採点した。',
        },
        confidence_low: {
          type: Type.BOOLEAN,
          description: '判定に自信がなく、登録を行わなかった問題がある場合に true',
        },
        questions: {
          type: Type.ARRAY,
          description: '問題ごとの添削結果',
          items: {
            type: Type.OBJECT,
            properties: {
              label: {
                type: Type.STRING,
                description: '問題番号。例: 大問1(2)',
              },
              result: {
                type: Type.STRING,
                enum: ['correct', 'partial', 'incorrect'],
              },
              error_location: {
                type: Type.STRING,
                description: '誤りの箇所。読み取った答案の該当部分を引用して、どこが誤りかを具体的に書く。正解のときは省略。',
              },
              cause: {
                type: Type.STRING,
                enum: ['knowledge', 'carelessness', 'both', 'none'],
              },
              knowledge_headings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'この問題で登録した知識項目の見出し',
              },
              tendency_names: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'この問題で記録した傾向名',
              },
            },
            required: ['label', 'result', 'cause'],
          },
        },
        past_relation: {
          type: Type.STRING,
          description: '過去との関連。傾向ログに基づく場合のみ。例: この符号ミスは、数学で直近3回出ています。',
        },
        note: {
          type: Type.STRING,
          description: 'ひとこと。別解、書き方の助言、優先度など。3〜4文以内。登録には使われない。',
        },
      },
      required: ['subject', 'basis', 'questions'],
    },
  },
];

interface ActiveGradingSession {
  sessionId: string;
  contents: Content[];
  tracker: ReviewSessionTracker;
  roundCount: number;
}

const activeSessions = new Map<string, ActiveGradingSession>();

export function clearAllSessions(): void {
  activeSessions.clear();
}

export function discardSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

function describeToolAction(name: string): string {
  switch (name) {
    case 'get_tendencies':
      return '過去の不注意ミス傾向を確認しています...';
    case 'get_tree':
      return '知識ノートの単元構成を確認しています...';
    case 'read_file':
      return '既存の知識項目を照合しています...';
    case 'save_file':
      return '知識不足の内容をノートに登録しています...';
    case 'record_tendency':
      return '不注意ミスの傾向を記録しています...';
    case 'create_folder':
    case 'move_item':
    case 'rename_item':
    case 'merge_items':
      return 'ノートの整理を処理しています...';
    case 'finalize_review':
      return '添削コメントを確定しています...';
    default:
      return '処理を進めています...';
  }
}

async function runGradingLoop(
  session: ActiveGradingSession,
  emit: (ev: ReviewProgressEvent) => void
): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    discardSession(session.sessionId);
    emit({
      type: 'error',
      code: 'MISSING_API_KEY',
      message: 'Gemini APIキーが設定されていません。右上の「環境設定」からAPIキーを入力してください。',
    });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });

  while (true) {
    const state = await loadState();
    const maxRounds = state.limits.maxToolRounds;

    if (session.roundCount >= maxRounds) {
      discardSession(session.sessionId);
      emit({
        type: 'error',
        code: 'MAX_ROUNDS_EXCEEDED',
        message: `ツール呼び出しの上限（${maxRounds}往復）に達したため添削を中断しました。別の答案として再試行してください。`,
      });
      return;
    }

    session.roundCount += 1;
    emit({
      type: 'progress',
      round: session.roundCount,
      message:
        session.roundCount === 1
          ? '答案を読み取り、採点と分析を開始しています...'
          : `AIチューターが分析を続けています（${session.roundCount}/${maxRounds}）...`,
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: session.contents,
      config: {
        systemInstruction: buildSystemPrompt(state),
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      },
    });

    const candidateContent = response.candidates?.[0]?.content;
    if (candidateContent) {
      session.contents.push(candidateContent);
    }

    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      const text = (response.text ?? '').trim();
      if (text) {
        emit({
          type: 'clarification',
          sessionId: session.sessionId,
          round: session.roundCount,
          message: text,
        });
        return;
      }
      discardSession(session.sessionId);
      emit({
        type: 'error',
        code: 'EMPTY_RESPONSE',
        message: 'AIからの応答を取得できませんでした。答案画像が鮮明か確認して再度お試しください。',
      });
      return;
    }

    const forceAllowTruncate = session.roundCount >= maxRounds - 1;
    const responseParts: Part[] = [];

    for (const fc of functionCalls) {
      const toolName = fc.name ?? '';
      const args = (fc.args ?? {}) as Record<string, unknown>;
      emit({
        type: 'progress',
        round: session.roundCount,
        message: describeToolAction(toolName),
      });

      const result = await executeAITool(toolName, args, session.tracker, forceAllowTruncate);
      responseParts.push({
        functionResponse: {
          id: fc.id,
          name: toolName,
          response: result,
        },
      });
    }

    if (session.tracker.finalizedReview) {
      const review = session.tracker.finalizedReview;
      discardSession(session.sessionId);
      const nextState = await loadState();
      emit({
        type: 'completed',
        review,
        state: nextState,
      });
      return;
    }

    if (session.roundCount >= maxRounds - 1) {
      responseParts.push({
        text: '【システム通知】ツール呼び出しの上限に近づいています。これ以上の整理（create_folder / move_item / rename_item / merge_items）は次回に回し、次の応答で必ず finalize_review を1回呼んで添削を完了してください。',
      });
    }

    session.contents.push({
      role: 'user',
      parts: responseParts,
    });
  }
}

export async function startReviewSession(
  attachments: AnswerAttachment[],
  memo: string | undefined,
  emit: (ev: ReviewProgressEvent) => void
): Promise<void> {
  clearAllSessions();

  const sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const userParts: Part[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    if (attachments.length > 1 && att.kind === 'image') {
      userParts.push({ text: `【答案 ${i + 1}ページ目】` });
    }
    const base64 = await blobToBase64(att.blob);
    userParts.push({
      inlineData: {
        mimeType: att.mimeType,
        data: base64,
      },
    });
  }

  userParts.push({
    text: memo?.trim()
      ? `この答案を添削してください。\n【ユーザーからのメモ】\n${memo.trim()}`
      : 'この答案を添削してください。',
  });

  const session: ActiveGradingSession = {
    sessionId,
    contents: [{ role: 'user', parts: userParts }],
    tracker: createSessionTracker(),
    roundCount: 0,
  };

  activeSessions.set(sessionId, session);

  try {
    await runGradingLoop(session, emit);
  } catch (err) {
    discardSession(sessionId);
    emit({
      type: 'error',
      message: formatGeminiError(err),
    });
  }
}

export async function replyToReviewSession(
  sessionId: string,
  replyText: string,
  emit: (ev: ReviewProgressEvent) => void
): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    emit({
      type: 'error',
      code: 'SESSION_EXPIRED',
      message: '確認セッションが見つからないか期限切れです。答案をもう一度送信してください。',
    });
    return;
  }

  session.contents.push({
    role: 'user',
    parts: [{ text: replyText.trim() }],
  });

  try {
    await runGradingLoop(session, emit);
  } catch (err) {
    discardSession(sessionId);
    emit({
      type: 'error',
      message: formatGeminiError(err),
    });
  }
}
