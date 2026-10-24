# App Privacy — FillOut

Проверено 17 октября и повторно сверено 24 октября 2026 года с текущим исходным кодом **1.0.0**, миграциями, установленными SDK и официальной документацией Apple/RevenueCat. Практики передачи анкет, Chat и покупок не изменились; ниже сохранены применимые категории. Это инструкция для декларации; настройки App Store Connect этой проверкой не изменялись.

## Что выбрать на iPhone

В Safari откройте App Store Connect → Apps → FillOut → App Privacy → Get Started / Edit.

1. **Yes, we collect data from this app.**
2. Отметьте категории из таблицы ниже, затем Save.
3. Откройте каждый выбранный тип: **App Functionality**, **Linked to the user's identity: Yes**, **Used for tracking: No**.
4. Для **Purchase History** и **User ID** дополнительно отметьте **Analytics**. Для остальных Analytics не добавляйте.
5. Проверьте Product Page Preview, затем Publish. Privacy Policy URL: `https://fillout.net/privacy/`; русский вариант: `https://fillout.net/ru/privacy/`. Оба адреса опубликованы и проверены. Публичный адрес для поддержки и обращений о данных, подтверждённый владельцем: `peoplechat2@gmail.com`.

Путь и необходимость завершить каждый тип перед Publish описаны в [инструкции Apple](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/). Apple разрешает это ролям Account Holder, Admin и App Manager: владелец не обязан лично заполнять таблицу, если доступна авторизованная сессия с подходящей ролью. Это отдельный шаг от подписи Paid Apps Agreement.

| Раздел Apple | Отметить | Почему это есть в FillOut |
| --- | --- | --- |
| Contact Info | **Name**, **Email Address**, **Phone Number**, **Physical Address**, **Other User Contact Info** | Аккаунт, контактная заявка, имена и адреса в отправленной анкете; отдельные формы включают контактный fax подготовителя. |
| Health & Fitness | **Health** | Ответы о медицинских состояниях и необходимых специальных условиях. HealthKit не используется. |
| Financial Info | **Other Financial Info** | Доход, активы и обязательства в финансовых формах. |
| Location | **Coarse Location** | Приблизительные страна/регион/город по IP в стандартных журналах облачного backend; приложение не запрашивает GPS. |
| Sensitive Info | **Sensitive Info** | Структурированные вопросы о расе/этнической принадлежности, инвалидности, политической принадлежности и другие чувствительные ответы USCIS. |
| User Content | **Emails or Text Messages**, **Customer Support**, **Other User Content** | Сохранённая переписка Chat с командой, обращения, вопросы адвокату, отправленные PDF и ответы. |
| Identifiers | **User ID**, **Device ID** | UUID аккаунта Supabase/RevenueCat; постоянный случайный идентификатор установки EAS, отправляемый Expo Updates. Это не утверждение о сборе IDFA. |
| Purchases | **Purchase History** | Товар, транзакция, состояние покупки и привязка оплаченного дела. |
| Diagnostics | **Crash Data**, **Performance Data**, **Other Diagnostic Data** | Ошибки запуска Expo Updates; длительность запросов, ошибки и технические журналы облачных сервисов. |
| Other Data | **Other Data Types** | Дата рождения, государственные идентификаторы (SSN, A-number, паспорт), гражданство, иммиграционная и иная история в отправленной анкете. |

**Не отмечать без изменения функциональности:** Payment Info, Credit Info, Fitness, Precise Location, Contacts, Photos or Videos, Audio Data, Gameplay Content, Browsing History, Search History, Product Interaction, Advertising Data, Other Usage Data, Environment Scanning, Hands, Head. Оплата Apple не передаёт FillOut реквизиты карты. Доход/долги относятся здесь к Other Financial Info, а не Credit Info. Адресная книга, фотоальбом, микрофон и GPS не считываются. Ввод произвольного текста сам по себе не доказывает сбор всех возможных категорий.

Не выбирать Third-Party Advertising, Developer's Advertising or Marketing, Product Personalization или Other Purposes: для текущего потока их использование не найдено. Ручная передача бесплатной заявки независимому адвокату после отдельного согласия служит запрошенной функции; это не рекламное отслеживание.

## Основания и границы

Данные локального черновика не отправляются автоматически. Однако Send for review передаёт полный PDF и снимок ответов с UUID аккаунта; это основной сервис, поэтому добровольность отправки не делает его «не собираемыми данными». Свободный текст покрывает Other User Content, а конкретные вопросы анкеты требуют соответствующих категорий. Apple учитывает связь через аккаунт **или устройство**, поэтому отсутствие email у Expo не является основанием выбрать Not linked для устойчивого идентификатора установки и связанных записей. Здесь выбрано Yes без заявления об анонимизации. [Правила Apple о сборе, optional disclosure, linkage и free-form fields](https://developer.apple.com/app-store/app-privacy-details/).

Категории анкеты следуют реальным полям, а не предположению, что пользователь может написать что угодно: I-90 содержит ethnicity/race и accommodation; I-134/I-864 — income/assets; I-821 — medical conditions; I-485 — political affiliation. Отдельного сбора отпечатков, сексуальной ориентации или фотографий эта проверка не установила. [Официальные определения категорий Apple](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype).

RevenueCat получает UUID аккаунта, который сервер может связать с контактом. Его официальная инструкция требует Purchase History с **App Functionality + Analytics**; User ID используется тем же платёжным сервисом. Analytics относится к истории/сводкам покупок в RevenueCat, а не к рекламной аналитике. В коде нет передачи PDF, ответов, имени, email или телефона в RevenueCat. [RevenueCat: Apple App Privacy](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy).

У `react-native-purchases` 10.13.0 / RevenueCat iOS 5.95.0 diagnostics выключены по умолчанию. Разрешённый по умолчанию automaticDeviceIdentifierCollection срабатывает при подключении attribution ID; соответствующих вызовов и collectDeviceIdentifiers в приложении нет. Поэтому Device ID в этой декларации основан на Expo, а не предположении об IDFA RevenueCat. Не следует копировать SDK privacy manifest как полную декларацию приложения. [Исходник конфигурации RevenueCat](https://github.com/RevenueCat/purchases-ios/blob/5.95.0/Sources/Purchasing/Configuration.swift).

Expo Updates включён и отправляет `EAS-Client-ID`, сведения о runtime/update и ошибках запуска. Сопоставление installation ID с категорией Device ID — наша консервативная классификация устойчивого идентификатора, не дословное указание Expo. Expo подтверждает, что ID сохраняется между запусками и является псевдонимным; его инструкция для App Store отдельно указывает Crash Data при expo-updates. [Expo Client ID](https://docs.expo.dev/eas/observe/reference/client-id/), [Expo: App stores best practices](https://docs.expo.dev/distribution/app-stores/). EAS Observe в приложение не добавлен: ссылка используется только для определения общего EAS client ID.

Coarse Location, Performance Data и Other Diagnostic Data основаны на документированных стандартных журналах Supabase: IP/приблизительная география, клиентские заголовки, авторизованный пользователь, состояние и длительность вызова. Не заявляется точность GPS или заполнение каждого поля в каждом запросе. Индивидуальные пользовательские журналы для этой проверки не выгружались; изменение/отключение журналирования требует повторной сверки декларации. [Supabase: поля журналов](https://supabase.com/docs/guides/observability/log-field-reference), [география IP в API logs](https://supabase.com/docs/guides/troubleshooting/discovering-and-interpreting-api-errors-in-the-logs-7xREI9), [журналы Edge Functions](https://supabase.com/docs/guides/functions/logging).

## Проверенные локальные источники

| Практика | Источник |
| --- | --- |
| Email/password/phone, профиль и UUID | `src/cloudClient.ts` (`signUpWithPassword`, `checkAccountDetails`) |
| Передача PDF + ответов, сохранение с user_id | `src/screens/FullFormPreparationScreen.tsx:247`, `src/formReview.ts:80`, `supabase/migrations/20261011000400_form_review.sql:3` |
| Реальные sensitive/health/financial поля | `data/uscis-i90-questionnaire.json:1841` и `:2332`; `data/uscis-guided-questionnaires.json:49405`, `:62378`, `:84271`, `:96663` |
| Non-SMS Chat и связь с аккаунтом | `src/supportChat.ts:45`, `supabase/migrations/20261011000100_support_chat.sql:3` |
| Контактная/адвокатская заявка и отдельное согласие | `supabase/functions/submit-request/handler.mjs`, `supabase/migrations/20261017000200_attorney_referral_consent.sql` |
| RevenueCat UUID, покупки и настройки SDK | `src/payments.ts` (`nativeSdk`); `ios/Podfile.lock`; `ios/Pods/RevenueCat/Sources/Purchasing/Configuration.swift:360` |
| Expo updates включены | `app.config.ts:9`, `ios/FillOut/Supporting/Expo.plist` |
| Installation ID, failed updates, fatal error | `node_modules/expo-updates/ios/EXUpdates/AppLoader/FileDownloader.swift:385`, `:448`, `:465`, `:469`; `node_modules/expo-eas-client/ios/EASClient/EASClientID.swift:6` |
| Публичная политика и отсутствие рекламных SDK | `web/policy-pages.mjs`, `package.json`; в исходном приложении не найдены рекламные/attribution-интеграции |

Если к релизу включаются новые analytics/advertising SDK, удалённый AI, загрузка фото/аудио или иная передача данных, эту таблицу нужно пересмотреть. Настоящая проверка не выполняла вход в App Store Connect и не публиковала ответы.
