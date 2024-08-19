export default class CNCSplashScreen {
    static name = 'CNCSplashScreen';
    static version = '0.1';
    static dependencies = [];
    static description = '(Beta) This module provides more splash screen images.';


    onLoad() {
        const imagePath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/')) + '/images/';
        const images = [
            'title_abyss.png',
            'title_animated_minimap_by_igooo.gif',
            'title_assassination_by_spdhatsan.png',
            'title_battle.png',
            'title_cerebov1.jpg',
            'title_cerebov2.png',
            'title_crab.png',
            'title_fannar_with_ice_magic_by_steelcold.jpg',
            'title_felid1.jpg',
            'title_felid_chaos_knight_goes_to_the_abyss_by_xomggulluk.jpg',
            'title_felid_fire_elementalist.png',
            'title_formicid.png',
            'title_formicid_by_froggy.png',
            'title_iron_giant_by_steelcold.png',
            'title_kobold.png',
            'title_mennas_by_steelcold.png',
            'title_mifi.png',
            'title_morneyo_tengu_air_mage_by_jonecrown.png',
            'title_nausea.png',
            'title_octopus.png',
            'title_roleplayer_tornado_square.gif',
            'title_ru_spriggan_by_greenpixduntranslateman.png',
            'title_shatter.png',
            'title_shining_one_fighter_with_trog.png',
            "title_sigmund's_smile_by_waagh.png",
            'title_stone_soup.png',
            'title_swordsman.png',
            'title_trog1.png',
            'title_trog2.png',
            'title_trog_fighter.png',
            'title_troll_gozag.png',
            'title_vinestalker_bites_lom_lobon_by steelcold.png',
            'title_xom.jpg',
            'title_yiuf.png'
        ];
        const loaderCenter = document.querySelector('#loader_center');
        for (const name of images) {
            const image = new Image();
            image.style.display = 'none';
            image.alt = '';
            image.loading = 'lazy'
            image.src = imagePath + name;
            loaderCenter.append(image);
        }
        const imageTags = Array.from(document.querySelectorAll('#loader_center img'));
        for (const tag of imageTags) {
            tag.style.maxWidth = '80vw';
            tag.style.maxHeight = '80vh';
        }
    }
}
