package mcore

import (
	"errors"
	"log"
	"math/rand"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

func TaskInit(mL []DbMangaEntry, pL []ProxyStruct) {
	errch := make(chan error)
	var err error

	for {
		for _, proxy := range pL {
			go Task(proxy, mL, errch)
			err = <-errch
			if err != nil {
				//if the task panics at any point it will be caught here and the task will be restarted
				continue
			} else {
				time.Sleep(5 * time.Minute)
			}
		}
		var wg sync.WaitGroup
		wg.Add(1)
		mChannel := make(chan []DbMangaEntry)
		go MangaSync(mChannel, &wg)
		mL = <-mChannel
		close(mChannel)
		log.Printf("Manga list Synced")
		time.Sleep(1 * time.Hour)
	}

}

func PlaywrightInit(proxy ProxyStruct, pw *playwright.Playwright) (playwright.BrowserContext, error) {

	device := pw.Devices[IphoneUserAgentList[rand.Intn(len(IphoneUserAgentList)-1)]]
	pwProxyStrct := playwright.Proxy{
		Server:   proxy.ip,
		Username: &proxy.usr,
		Password: &proxy.pw,
	}

	browser, err := pw.WebKit.LaunchPersistentContext("", playwright.BrowserTypeLaunchPersistentContextOptions{
		Viewport:          device.Viewport,
		UserAgent:         playwright.String(device.UserAgent),
		DeviceScaleFactor: playwright.Float(device.DeviceScaleFactor),
		IsMobile:          playwright.Bool(device.IsMobile),
		HasTouch:          playwright.Bool(device.HasTouch),
		Headless:          playwright.Bool(false),
		//RecordHarContent: playwright.HarContentPolicyAttach,
		//RecordHarMode: playwright.HarModeFull,
		//RecordHarPath: playwright.String("test.har"),

		ColorScheme: playwright.ColorSchemeDark,
		Proxy:       &pwProxyStrct,
		IgnoreDefaultArgs: []string{
			"--enable-automation",
		},
	})
	if err != nil {
		log.Fatalf("could not launch browser: %v", err)
	}

	script := playwright.Script{
		Content: playwright.String(`
    const defaultGetter = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "webdriver"
    ).get;
    defaultGetter.apply(navigator);
    defaultGetter.toString();
    Object.defineProperty(Navigator.prototype, "webdriver", {
      set: undefined,
      enumerable: true,
      configurable: true,
      get: new Proxy(defaultGetter, {
        apply: (target, thisArg, args) => {
          Reflect.apply(target, thisArg, args);
          return false;
        },
      }),
    });
    const patchedGetter = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "webdriver"
    ).get;
    patchedGetter.apply(navigator);
    patchedGetter.toString();
  `),
	}
	err = browser.AddInitScript(script)
	if err != nil {
		log.Fatalf("could not add initialization script: %v", err)
	}

	log.Printf("Browser Launched, user agent: %v, Proxy: %v : %v \n", device, proxy.ip, proxy.pw)
	log.Println()
	return browser, nil
}

func Task(proxy ProxyStruct, manga []DbMangaEntry, errch chan error) {
	defer func() {
		if err := recover(); err != nil {
			log.Printf("Recovered from panic: %v assuming bad proxy", err)
			time.Sleep(15 * time.Second)
			err := errors.New("recovered from panic")
			errch <- err
		}
	}()
	log.Println("Initializing playwright instance")
	PlaywrightInstance, err := playwright.Run()
	defer func(PlaywrightInstance *playwright.Playwright) {
		err := PlaywrightInstance.Stop()
		if err != nil {
			log.Panicf("could not stop playwright: %v", err)
		}
	}(PlaywrightInstance)
	browser, err := PlaywrightInit(proxy, PlaywrightInstance)
	defer func(browser playwright.BrowserContext, options ...playwright.BrowserContextCloseOptions) {
		err := browser.Close()
		if err != nil {
			log.Panicf("could not close browser: %v", err)
		}
	}(browser)
	if err != nil {
		log.Panicf("could not initialize playwright: %v", err)
	}
	page, err := browser.NewPage()
	if err != nil {
		log.Fatalf("could not create page: %v", err)
	}
	defer func(page playwright.Page, options ...playwright.PageCloseOptions) {
		err := page.Close()
		if err != nil {

		}
	}(page)
	//Could I have typed this as a for range? yes,
	//But I want this function to be in the java style for goodtimes sakes
	for i := 0; i < len(manga); i++ {
		if theMap[manga[i].Didentifier](manga[i], browser, page) {
			manga[i].DlastChapter = manga[i].DlastChapter + 1
			manga[i].DchapterLink = page.URL()
			WebhookSend(manga[i])
			MangaUpdate(manga[i])
			log.Printf("PAGE IS LIVE for %v, updated chapter to %v", manga[i].Dmanga, manga[i].DlastChapter)
		} else {
			log.Printf("Page not live for %v, will keep monitoring", manga[i].Dmanga)
			page.Goto("https://www.google.com")
			continue
		}
		page.Goto("https://www.google.com")
	}
	page.Goto("https://www.google.com")
	log.Printf("finished task for proxy :%v", proxy.ip)
	errch <- nil

}
