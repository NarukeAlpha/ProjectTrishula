package mcore

import (
	"log"
	"math/rand"
	"sync"
	"time"

	"ProjectTrishula/Core"
	"github.com/playwright-community/playwright-go"
)

func TaskInit(mL []DbMangaEntry, pL []ProxyStruct, wbKey string) {
	//old implementation was gigascuffed, needs a full rewrite to take advantage of concurrency
	//removed go routines for now, will be redone as application grows bigger but initial structure was made
	//keeping in mind later implementation.
	errch := make(chan error)
	var err error
	for {
		for _, proxy := range pL {
			go Task(proxy, mL, wbKey)
			err = <-errch
			if err != nil {
				continue
			} else {
				time.Sleep(3 * time.Minute)
			}
		}
		var wg sync.WaitGroup
		wg.Add(1)
		mChannel := make(chan []DbMangaEntry)
		MangaSync(mChannel, &wg)
		mL = <-mChannel
		close(mChannel)
		log.Printf("Manga list Synced")
		time.Sleep(10 * time.Minute)
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
		//	Headless:          playwright.Bool(false),
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

	log.Printf("Browser Launched, user agent: %v, Proxy: %v : %v \n", device.UserAgent, proxy.ip, proxy.pw)
	log.Println()
	return browser, nil
}

func Task(proxy ProxyStruct, manga []DbMangaEntry, wbKey string) {
	defer func() {
		if err := recover(); err != nil {
			log.Printf("Recovered from panic: %v", err)
		}
	}()
	log.Println("Initializing playwright instance")
	PlaywrightInstance, err := playwright.Run()
	browser, err := PlaywrightInit(proxy, PlaywrightInstance)
	if err != nil {
		log.Panicf("could not initialize playwright: %v", err)
	}
	page, err := browser.NewPage()
	if err != nil {
		log.Fatalf("could not create page: %v", err)
	}
	for i := 0; i < len(manga); i++ {
		cLink := ChapterLinkIncrementer(manga[i].DchapterLink, manga[i].DlastChapter)
		if theMap[manga[i].Didentifier](manga[i], browser, page, cLink) {
			WebhookSend(manga[i], wbKey)
			manga[i].DlastChapter = manga[i].DlastChapter + 1
			manga[i].DchapterLink = cLink
			MangaUpdate(manga[i])
			log.Printf("PAGE IS LIVE")
		} else {
			log.Printf("Page not live, will keep monitoring")
			continue
		}
	}
	log.Printf("finished task for proxy :%v", proxy.ip)
	Core.AssertErrorToNil("Failed to close Page", page.Close())
	Core.AssertErrorToNil("Failed to close Browser", browser.Close())
	Core.AssertErrorToNil("Failed to close Playwright", PlaywrightInstance.Stop())

}
