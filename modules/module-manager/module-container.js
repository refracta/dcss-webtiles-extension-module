export default class ModuleContainer extends HTMLDivElement {
    constructor() {
        super();
        const span = document.createElement('div');
        span.innerHTML = `<div class="ui-popup" data-generation-id="3">
<div class="ui-popup-overlay"></div>
<div class="ui-popup-outer">
<div class="ui-popup-inner"><div class="describe-item">
<div class="header">
<canvas class="glyph-mode-hidden" width="80" height="80" style="width: 64px; height: 64px;"></canvas>
<span>a - a +0 robe (worn).</span>
</div>
<div class="body fg7" data-simplebar="init"><div class="simplebar-track vertical" style="visibility: hidden;"><div class="simplebar-scrollbar visible"></div></div><div class="simplebar-track horizontal" style="visibility: visible;"><div class="simplebar-scrollbar visible" style="width: 25px; transform: translate3d(0px, 0px, 0px);"></div></div><div class="simplebar-scroll-content" style="padding-right: 37px; margin-bottom: -34px;"><div class="simplebar-content" style="padding-bottom: 17px; margin-right: -20px;"><pre><span class="fg7"></span></pre><pre>로브:</pre><pre>천으로 만든 크고 헐렁한, 소매가 넓은 외출용 의복이다. 로브는 아무리 거대한 종족이라도 쉽게 입을 수 있다. 이런 종류의 의복은 물리적 피해를 거의 막아주지 못하지만, 마법 시전에 거슬리거나 조용한 움직임을 방해하지 않기 때문에 마법사와 암살자들에게 사랑받는 옷이다. </pre><pre>Base armour rating: 2       Encumbrance rating: 0</pre><pre>It can be maximally enchanted to +2.</pre><pre>If you take off this armour:<br>Your AC would decrease by 2.0 (2.0 -&gt; 0.0).<br>Your EV would remain unchanged.</pre><pre><br>Stash search prefixes: {inventory} {body armour} {body armor}<br>Menu/colouring prefixes: identified equipped armour</pre><pre>로브:</pre><pre>"클레오파트라: 내 로브를 줘, 내 왕관을 씌워줘. 꺼지지 않는 갈망이 내 안에 있다."<br>   -윌리엄 셰익스피어, _Anthony &amp; Cleopatra_, V, ii. ca. 1605.<br></pre></div></div><div class="scroller-shade top" style="opacity: 0;"></div><div class="scroller-shade bot" style="opacity: 0.0425;"></div><span class="scroller-lhd">_</span></div>
<div class="actions"><span data-hotkey="t">(t)ake off</span>, <span data-hotkey="d">(d)rop</span>, <span data-hotkey="=">(=)adjust</span>, or <span data-hotkey="i">(i)nscribe</span>.</div>
</div></div>
</div>
</div>`;
        this.append(span);
        this.classList.add('module-container');
    }
}
customElements.define('module-container', ModuleContainer, {extends: 'div'});
