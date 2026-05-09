import {ensureStyle} from './utils.js';

const APRIL_FOOLS_HIDE_DATE_KEY = 'CNC_BANNER_APRIL_FOOLS_HIDE_DATE';

function getTodayKey() {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const date = String(today.getDate()).padStart(2, '0');
    return `${today.getFullYear()}-${month}-${date}`;
}

export function getAprilFoolsOverlayHTML(aprilImage, locale = 'ko') {
    const todayKey = getTodayKey();
    if (localStorage.getItem(APRIL_FOOLS_HIDE_DATE_KEY) === todayKey) {
        return '';
    }

    const footerText = locale === 'ko'
        ? `인생은 <span style="color: lawngreen">Deal Four </span>아니면 <span style="color: darkorchid">Stack Five</span>다!`
        : `Life is either <span style="color: lawngreen">Deal Four</span> or <span style="color: darkorchid">Stack Five</span>!`;
    const closeText = locale === 'ko' ? '오늘 하루 보지 않기' : 'Hide for today';

    return `
    <style>
        .af-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }

        .af-container {
            background-color: #000;
            border: 1px solid #626262;
            padding: 10px;
            box-sizing: border-box;
        }

        .af-container img {
            width: 500px;
            height: 500px;
            display: block;
            z-index: 99999;
        }

        .af-footer {
            display: flex;
            justify-content: space-between;
            color: #fff;
            font-size: 14px;
            margin-top: 5px;
        }

        .close-btn {
            cursor: pointer;
            text-decoration: underline;
        }
    </style>

    <div class="af-overlay">
        <div class="af-container">
            <img src="${aprilImage}" alt="af">
            <div class="af-footer">
                <span>${footerText}</span>
                <span class="close-btn" onclick="localStorage.setItem('${APRIL_FOOLS_HIDE_DATE_KEY}', '${todayKey}'); document.querySelector('.af-overlay')?.remove();">${closeText}</span>
            </div>
        </div>
    </div>
    `;
}

export function applyXMasTheme() {
    const existingBanner = document.getElementById('christmas-banner-msg');
    if (existingBanner) {
        existingBanner.remove();
    }

    const today = new Date();
    const isHeavySnow = today.getMonth() === 11 && today.getDate() >= 23;
    const snowGradients = (isHeavySnow
        ? [
            'radial-gradient(2px 2px at 10px 20px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 30px 60px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(3px 3px at 50px 120px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 70px 35px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 90px 90px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(3px 3px at 110px 150px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 130px 25px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 145px 70px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 120px 110px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 40px 95px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(3px 3px at 75px 145px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 155px 120px, #ffffff, rgba(0,0,0,0))'
        ]
        : [
            'radial-gradient(2px 2px at 20px 30px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 40px 70px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 50px 160px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 90px 40px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 130px 80px, #ffffff, rgba(0,0,0,0))'
        ]).join(',\n                ');
    const snowGradientsBack = (isHeavySnow
        ? [
            'radial-gradient(1px 1px at 15px 45px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 35px 110px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(1px 1px at 55px 75px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 75px 155px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(1px 1px at 95px 25px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 115px 95px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(1px 1px at 135px 140px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 155px 60px, #ffffff, rgba(0,0,0,0))'
        ]
        : [
            'radial-gradient(1px 1px at 15px 45px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 55px 120px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(1px 1px at 95px 35px, #ffffff, rgba(0,0,0,0))',
            'radial-gradient(2px 2px at 135px 90px, #ffffff, rgba(0,0,0,0))'
        ]).join(',\n                ');
    const snowSize = isHeavySnow ? 180 : 220;
    const snowOpacity = isHeavySnow ? 0.65 : 0.4;
    const snowDuration = isHeavySnow ? 2.5 : 4;
    const snowSizeBack = isHeavySnow ? 240 : 300;
    const snowOpacityBack = isHeavySnow ? 0.4 : 0.25;
    const snowDurationBack = isHeavySnow ? 6 : 8;
    const snowSway = isHeavySnow ? 50 : 30;
    const snowSwayBack = isHeavySnow ? -35 : -20;
    const snowSwayDuration = isHeavySnow ? 6 : 8;
    const snowSwayDurationBack = isHeavySnow ? 9 : 12;

    const css = `
        #lobby {
            background: radial-gradient(circle at center, #0f2b1d 0%, #000000 100%) !important;
            min-height: 100vh;
            position: relative;
            color: #ffffff !important;
        }

        #lobby::before {
            content: "";
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image:
                ${snowGradients};
            background-repeat: repeat;
            background-size: ${snowSize}px ${snowSize}px;
            animation: snowFall ${snowDuration}s linear infinite,
                       snowSway ${snowSwayDuration}s ease-in-out infinite alternate;
            pointer-events: none;
            z-index: 0;
            opacity: ${snowOpacity};
        }

        @keyframes snowFall {
            0% { background-position: 0 0; }
            100% { background-position: 0 ${snowSize}px; }
        }

        @keyframes snowSway {
            0% { transform: translateX(0); }
            100% { transform: translateX(${snowSway}px); }
        }

        #lobby::after {
            content: "";
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-image:
                ${snowGradientsBack};
            background-repeat: repeat;
            background-size: ${snowSizeBack}px ${snowSizeBack}px;
            animation: snowFallBack ${snowDurationBack}s linear infinite,
                       snowSwayBack ${snowSwayDurationBack}s ease-in-out infinite alternate;
            pointer-events: none;
            z-index: 0;
            opacity: ${snowOpacityBack};
        }

        @keyframes snowFallBack {
            0% { background-position: 0 0; }
            100% { background-position: 0 ${snowSizeBack}px; }
        }

        @keyframes snowSwayBack {
            0% { transform: translateX(0); }
            100% { transform: translateX(${snowSwayBack}px); }
        }

        #lobby a, #lobby a:link, #lobby a:visited, #lobby a:active {
            color: #ffffff !important;
            text-decoration: none;
            transition: color 0.3s ease;
            position: relative;
            z-index: 2;
        }
        #lobby a:hover {
            color: #ff4500 !important;
            text-shadow: 0 0 5px #ff4500;
        }

        #banner {
            border-bottom: 3px dashed #c0392b;
            padding-bottom: 10px;
            margin-bottom: 15px;
        }

        #player_list {
            background: rgba(0, 0, 0, 0.6);
            border: 1px solid #555;
            border-radius: 8px;
            overflow: hidden;
            position: relative;
            z-index: 2;
        }
        #player_list th.header {
            background-color: #800000 !important;
            color: #ffffff !important;
            border-bottom: 2px solid #ffffff;
        }
        #player_list tr:hover {
            background-color: rgba(46, 204, 113, 0.2) !important;
        }

        .milestone { color: #bdc3c7 !important; }
        .username a { color: #ffffff !important; font-weight: bold; }

        #lobby .button, #lobby input[type="button"], #lobby input[type="submit"] {
            background: linear-gradient(to bottom, #c0392b, #800000) !important;
            color: white !important;
            border: 1px solid #ffffff !important;
            border-radius: 4px;
            font-weight: bold;
            cursor: pointer;
            z-index: 2;
            position: relative;
        }
        #lobby .button:hover {
            background: linear-gradient(to bottom, #e74c3c, #c0392b) !important;
        }

        #chat {
            background-color: rgba(10, 30, 10, 0.95) !important;
            border: 2px solid #c0392b !important;
            border-radius: 10px;
            z-index: 3000 !important;
        }
        #chat_input {
            background-color: #222;
            color: #fff;
            border: 1px solid #555;
        }
    `;

    ensureStyle('christmas-theme-style', css);
    console.log('Christmas theme updated (No Text, Lobby Only)!');
}
