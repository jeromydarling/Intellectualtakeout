---
title: "Finding COVID-19’s True Fatality Rate"
description: "Early reports from January painted a grim picture about just how deadly the coronavirus was. Initially, the World Health Organization estimated that the percentage of infected individuals who die from COVID-19 was 3.4 percent. That statistic is called the infection fatality rate (IFR) – or colloquia"
pubDate: "2020-07-16T00:00:00Z"
updatedDate: "2020-07-16T00:00:00Z"
author: "Justin Silverman"
authorSlug: "justinsilverman"
categories: ["Science"]
categorySlugs: ["science"]
tags: []
heroImage: "/wp-content/uploads/2022/03/5de67e6e5f41429396865bfee441e9141.jpg"
wpId: "72261"
---

Early reports from January painted a grim picture about just how deadly the coronavirus was. Initially, the World Health Organization estimated that the percentage of infected individuals who die from COVID-19 [was 3.4 percent](https://www.cnbc.com/2020/03/03/who-says-coronavirus-death-rate-is-3point4percent-globally-higher-than-previously-thought.html). That statistic is called the infection fatality rate (IFR) – or colloquially, the death rate – and means that for every hundred people infected with COVID-19, on average, between three and four would die.

As time has gone on, it has become clear that the true risk of death is much lower. The Centers for Disease Control and Prevention currently has a best guess of [0.65 percent for the IFR](https://www.cdc.gov/coronavirus/2019-ncov/hcp/planning-scenarios.html#box). But current estimates fall anywhere between [0.2 percent and 1 percent](https://doi.org/10.1101/2020.05.03.20089854), a surprisingly large range when calculating the infection fatality rate should be as simple as dividing the number of deaths by total infections. And these estimates are changing all the time. In fact, in the time it took to write this article, the CDC changed its best estimate of the fatality rate from 0.26 percent to 0.65 percent.

We are two researchers who take a mathematical approach to solving [epidemiological](https://www.alexwashburne.com/) and [biomedical problems](http://justin-silverman.com). Back in early March, we published a paper showing that [millions more people had been infected with COVID-19](https://doi.org/10.1126/scitranslmed.abc1126) than official case counts reflected. But when we tried to use our results to calculate IFR in the U.S., we encountered firsthand just how difficult it is to do.

To calculate the infection fatality rate, researchers need to know three things: the number of infections, the number of deaths from infections and which deaths go with which infections. But finding these numbers is far harder than it might seem and these difficulties explain why there has been, and continues to be, so much uncertainty regarding this important number.

<figure class="align-center zoomable"><p><span style="font-size: 1.7rem;">How many infections?</span></p></figure>

Knowing how many people have been infected with the coronavirus is the first step to estimating the fatality rate.

The number of officially reported cases reflects only the number of diagnosed cases which is [far less than the real number](https://www.businessinsider.com/real-number-of-coronavirus-cases-underreported-us-china-italy-2020-4) of people who have been infected.

Since health officials can’t test everyone, one way to estimate the rate of infection in a population is to test a smaller group of people for signs of previous infection, [regardless of whether they have had symptoms](https://theconversation.com/can-people-spread-the-coronavirus-if-they-dont-have-symptoms-5-questions-answered-about-asymptomatic-covid-19-140531). If the smaller group is chosen in a way that makes it demographically representative of the larger population, then researchers can assume the infection rates they find in their test groups are [close to the actual population-wide numbers](https://theconversation.com/want-to-know-how-many-people-have-the-coronavirus-test-randomly-135784).

By taking this approach, researchers have now shown that the total number of infections is likely much larger than the number of diagnosed cases. For example, researchers in New York now estimate that by the end of March, [over 2 million residents of New York State had been infected](http://dx.doi.org/10.1016/j.annepidem.2020.06.004). At the time, there were only [76,000 confirmed infections](https://coronavirus.jhu.edu/us-map).

Our study took a different approach. We looked at records of doctors visits with patients that had flu-like symptoms but not the flu. By accounting for the number of people who would only have mild symptoms of COVID-19 and would not go to the doctors, we estimate that during the last three weeks of March [over 8.7 million Americans were infected with SARS-CoV-2](http://dx.doi.org/10.1126/scitranslmed.abc1126). During the same three week period, official case counts recorded just over [100,000 new infections within the U.S.](https://coronavirus.jhu.edu/us-map)

Putting this all together, it’s now clear that there have been many more infections than confirmed cases, likely by a factor of 20 or more.

## How many deaths?

Determining whether COVID-19 was the cause of death – and counting all of those deaths – [has been more difficult than you might think](https://fivethirtyeight.com/features/coronavirus-deaths/).

Recently, the New York Times reported that at a national level, COVID-19 deaths may be [undercounted by 25 percent](https://www.nytimes.com/interactive/2020/05/05/us/coronavirus-death-toll-us.html). These estimates are coming from the fact that deaths from any cause are far higher this year than normal. Over the course of the pandemic, many patients have died of symptoms similar to COVID-19, but were never tested. In addition, many people are [dying at home](https://fivethirtyeight.com/features/coronavirus-deaths/) from complications that appear to be COVID-19, but are also never tested.

Both infections and deaths have been undercounted, but not to the same degree. Our research suggests health officials were only [detecting as few as 1 in 80 infections](http://dx.doi.org/10.1126/scitranslmed.abc1126) whereas they have been catching approximately [4 in 5 deaths](https://www.nytimes.com/interactive/2020/05/05/us/coronavirus-death-toll-us.html). As we’ve been discovering uncounted infections at a faster rate than we’ve been discovering uncounted deaths, infection fatality rate estimates have dropped from initial guesses.

<figure class="align-center zoomable"><p><span style="font-size: 1.7rem;">Relation between infections and death</span></p></figure>

Even if health officials had accurate pictures of the number of infections and deaths over time, they can’t just divide the number of deaths by March 15 by the number of infections by March 15. It can take weeks before an infected patient dies from COVID-19. To calculate the fatality rate, researchers must correct for the time between the onset of infection and death.

While there is still uncertainty in this lag between onset of infection and deaths, recent research suggests that a [16-day lag between symptom onset and death](https://doi.org/10.3201/eid2607.200282) is a good guess.

This lag must be factored into infection fatality rate calculations. For example, assuming patients would get diagnosed within a few days of developing symptoms, to calculate the fatality rate on June 15, researchers would want to divide those deaths by the number of infections on June 1.

## So are current estimates any good?

Until the U.S. has more widespread random population testing and there’s more research to understand the time lag between infection and death, estimates of the real infection fatality rate will have some uncertainty. Still, since estimates of the actual infection and death numbers are far more accurate today than at the beginning of the pandemic, the current estimates of [between 0.2 to 1 percent](https://doi.org/10.1101/2020.05.03.20089854) are better as well. The CDC suggests that an [IFR of 0.65 percent is the current best estimate](https://www.cdc.gov/coronavirus/2019-ncov/hcp/planning-scenarios.html#box).

It is important to remember that these estimates of infection fatality rates reflect the risk for the average person. Many people will face higher risk and many will face lower risk.

Older patients or those with preexisting conditions like diabetes, high blood pressure or heart disease are likely at [higher risk than the average person](https://dx.doi.org/10.1183%2F13993003.00547-2020). Younger people without significant prior health conditions are at substantially lower risk than the average person. Additionally, [access to health care is an important factor](https://theconversation.com/rural-america-is-more-vulnerable-to-covid-19-than-cities-are-and-its-starting-to-show-140532) in mortality from COVID-19.

Finally, the infection fatality rate is not set in stone – it is an estimate of what happened in the past, not a predictor of what will happen in the future. If people follow public health guidance on mask wearing, social distancing and self-isolation when sick, it may be possible to reduce infections in high-risk populations and lower the percentage of people that die from this disease. But the opposite is also true. If the virus increasingly spreads in vulnerable populations, or if hospitals become overwhelmed and people can’t access the care they need to recover, more people could die.

While doctors, public health experts and laboratory researchers are working to secure treatments that will keep people alive even if they do become infected, statisticians like us will keep watching the numbers to help guide policy. It is up to everyday people to change their behavior to change the numbers we see.

—

_This article is republished from_ [The Conversation](https://theconversation.com) _under a Creative Commons license. Read the [original article](https://theconversation.com/how-deadly-is-the-coronavirus-the-true-fatality-rate-is-tricky-to-find-but-researchers-are-getting-closer-141426)._

Image Credit:   
Jason W. Edwards, U.S. Army
