export default class SoundSupport {
    static name = 'SoundSupport'
    static version = '1.0'
    static dependencies = ['RCManager']
    static description = '(Alpha) This module implements sound features in the webtiles environment. You can use it by adding a sound pack to the RC configuration.'

    #getSoundPacks(rcfile) {
        const matches = rcfile.match(/dwem_sound_pack\s*\+=\s*.+/g);
        const soundPacks = [];
        if (matches) {
            for (const line of matches) {
                soundPacks.push(line.split('+=').pop().trim());
            }
        }
        return soundPacks;
    }

    onLoad() {
        const {RCManager} = DWEM.Modules;
        RCManager.watchers.push((msg, data) => {
            if (msg === 'play') {
                const soundPacks = this.#getSoundPacks(data.contents);

            }
        });
    }
}
